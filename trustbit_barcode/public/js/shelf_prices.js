/**
 * Trustbit Barcode — shelf prices (v1.1.0)
 *
 * One item can be on the shelf at two printed prices (old stock at the old MRP,
 * new stock at the new one). `trustbit_shelf` keeps the short list of active
 * shelf prices in the browser (refreshed every 2 minutes) and offers:
 *
 *   trustbit_shelf.start(price_list)          load now, then refresh every 2 min
 *   trustbit_shelf.prices_for(item_code)      [{price, barcode}] sorted by price
 *   trustbit_shelf.price_for_barcode(code)    {item_code, price} or null
 *   trustbit_shelf.pick(title, prices)        Promise<price | null> (the picker)
 *
 * POS Awesome uses it when present. On desk Sales Invoices an item with two or
 * more active prices asks which price is printed on the copy (a scanned price
 * barcode decides by itself); the chosen price replaces the Item Price and the
 * usual discounts apply on top of it.
 */

var trustbit_shelf = {
	REFRESH_MS: 120000,
	by_item: {},
	by_barcode: {},
	price_list: null,
	loaded_at: 0,
	timer: null,
	loading: null,

	load(price_list) {
		const me = this;
		if (me.loading) return me.loading;
		me.loading = frappe
			.xcall("trustbit_barcode.shelf_prices.get_active_shelf_prices", {
				price_list: price_list || me.price_list || null,
			})
			.then((r) => {
				const by_item = {},
					by_barcode = {};
				Object.entries((r && r.by_item) || {}).forEach(([item_code, rows]) => {
					by_item[item_code] = rows.slice().sort((a, b) => a.price - b.price);
					rows.forEach((row) => {
						if (row.barcode) by_barcode[row.barcode] = { item_code, price: row.price };
					});
				});
				me.by_item = by_item;
				me.by_barcode = by_barcode;
				me.price_list = r && r.price_list;
				me.loaded_at = Date.now();
			})
			.catch((e) => console.warn("Shelf prices could not be loaded", e))
			.finally(() => {
				me.loading = null;
			});
		return me.loading;
	},

	start(price_list) {
		const me = this;
		if (price_list) me.price_list = price_list;
		if (!me.timer) {
			me.timer = setInterval(() => {
				if (!document.hidden) me.load();
			}, me.REFRESH_MS);
		}
		return me.load();
	},

	/** Load if never loaded or older than the refresh interval. */
	ensure() {
		if (Date.now() - this.loaded_at < this.REFRESH_MS) return Promise.resolve();
		return this.load();
	},

	prices_for(item_code) {
		return (item_code && this.by_item[item_code]) || [];
	},

	price_for_barcode(barcode) {
		return (barcode && this.by_barcode[String(barcode).trim()]) || null;
	},

	/**
	 * Ask which price is printed on the copy. Resolves with the price, or null
	 * when the dialog is closed (Esc) without choosing.
	 *
	 * Keys 1–9 pick a price, but only when typed by hand: a barcode scanner types
	 * a burst of keys and ends with Enter, and neither may choose a price.
	 */
	pick(title, prices) {
		return new Promise((resolve) => {
			let done = false;
			const d = new frappe.ui.Dialog({
				title: __("Which price is printed on this copy?"),
				fields: [{ fieldtype: "HTML", fieldname: "body" }],
			});
			const finish = (price) => {
				if (done) return;
				done = true;
				d.hide();
				resolve(price);
			};
			const buttons = prices
				.map(
					(p, i) =>
						`<button type="button" class="btn btn-default btn-lg" data-i="${i}" tabindex="-1"
							style="min-width: 120px; font-size: 1.25rem;">
							<span class="text-muted" style="font-size: 0.85rem;">${i + 1}</span>&nbsp;
							${format_currency(p.price)}</button>`
				)
				.join("");
			d.fields_dict.body.$wrapper.html(`
				<div style="margin-bottom: 12px; font-weight: 600;">${frappe.utils.escape_html(title || "")}</div>
				<div style="display: flex; flex-wrap: wrap; gap: 10px;">${buttons}</div>
				<div class="text-muted small" style="margin-top: 12px;">
					${__("Press the number or click the price. Esc: do not add the item.")}
				</div>`);
			d.fields_dict.body.$wrapper.on("click", "button[data-i]", (e) => {
				finish(prices[+e.currentTarget.dataset.i].price);
			});

			let last_key_at = 0,
				pending = null;
			d.$wrapper.on("keydown", (e) => {
				const now = Date.now(),
					burst = now - last_key_at < 50;
				last_key_at = now;
				if (e.key === "Enter") {
					e.preventDefault();
					return;
				}
				if (burst) {
					clearTimeout(pending);
					pending = null;
					return;
				}
				const n = parseInt(e.key, 10);
				if (n >= 1 && n <= prices.length) {
					e.preventDefault();
					clearTimeout(pending);
					pending = setTimeout(() => finish(prices[n - 1].price), 80);
				}
			});
			d.onhide = () => {
				clearTimeout(pending);
				if (!done) {
					done = true;
					resolve(null);
				}
			};
			d.show();
			// Keys go to the dialog, not to the search box behind it; no button
			// has focus, so a scanner's Enter cannot press one.
			setTimeout(() => d.$wrapper.find(".modal-content").attr("tabindex", "-1").trigger("focus"), 50);
		});
	},

	// ---- desk Sales Invoice ------------------------------------------------

	target_rate(row) {
		return flt(row.custom_shelf_price) * (flt(row.conversion_factor) || 1);
	},

	/** Keep price_list_rate on the chosen shelf price whatever ERPNext fetched. */
	keep_price(frm, cdt, cdn) {
		const row = locals[cdt] && locals[cdt][cdn];
		if (!row || !flt(row.custom_shelf_price) || frm.doc.docstatus !== 0) return;
		const target = this.target_rate(row);
		if (Math.abs(flt(row.price_list_rate) - target) > 0.005) {
			frappe.model.set_value(cdt, cdn, "price_list_rate", target);
		}
	},

	set_choice(frm, cdt, cdn, price) {
		return frappe.model
			.set_value(cdt, cdn, "custom_shelf_price", price)
			.then(() => this.keep_price(frm, cdt, cdn));
	},

	on_item_code(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (frm.doc.docstatus !== 0) return;
		if (flt(row.custom_shelf_price)) frappe.model.set_value(cdt, cdn, "custom_shelf_price", 0);
		const item_code = row.item_code;
		if (!item_code) return;
		// The desk scanner sets the item first and the barcode just after it.
		setTimeout(async () => {
			const r = locals[cdt] && locals[cdt][cdn];
			if (!r || r.item_code !== item_code || flt(r.custom_shelf_price)) return;
			await this.ensure();
			const bound = this.price_for_barcode(r.barcode);
			if (bound && bound.item_code === item_code) {
				return this.set_choice(frm, cdt, cdn, bound.price);
			}
			const prices = this.prices_for(item_code);
			if (prices.length < 2) return;
			const price = await this.pick(r.item_name || item_code, prices);
			if (price && locals[cdt][cdn] && locals[cdt][cdn].item_code === item_code) {
				this.set_choice(frm, cdt, cdn, price);
			}
		}, 300);
	},
};

window.trustbit_shelf = trustbit_shelf;

frappe.ui.form.on("Sales Invoice Item", {
	item_code(frm, cdt, cdn) {
		trustbit_shelf.on_item_code(frm, cdt, cdn);
	},
	price_list_rate(frm, cdt, cdn) {
		trustbit_shelf.keep_price(frm, cdt, cdn);
	},
	conversion_factor(frm, cdt, cdn) {
		trustbit_shelf.keep_price(frm, cdt, cdn);
	},
});

frappe.ui.form.on("Item", {
	refresh(frm) {
		if (frm.is_new()) return;
		trustbit_shelf.ensure().then(() => {
			const prices = trustbit_shelf.prices_for(frm.doc.name);
			if (!prices.length) return;
			const list = prices
				.map((p) => format_currency(p.price) + (p.barcode ? ` (${frappe.utils.escape_html(p.barcode)})` : ""))
				.join(" · ");
			frm.dashboard.add_comment(
				__("On the shelf at: {0}. Untick a price in {1} when its copies are gone.", [
					list,
					`<a href="/app/shelf-price?item_code=${encodeURIComponent(frm.doc.name)}&active=1">${__("Shelf Price")}</a>`,
				]),
				"blue",
				true
			);
		});
	},
});
