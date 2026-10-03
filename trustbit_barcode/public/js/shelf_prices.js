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
			.catch((e) => {
				console.warn("Shelf prices could not be loaded", e);
				// Without the list an old copy would be billed at the new price:
				// say so (at most once a minute) instead of failing silently.
				if (Date.now() - (me.warned_at || 0) > 60000) {
					me.warned_at = Date.now();
					frappe.show_alert(
						{
							message: __("Shelf prices could not be loaded — check the price printed on each copy."),
							indicator: "orange",
						},
						10
					);
				}
			})
			.finally(() => {
				me.loading = null;
			});
		return me.loading;
	},

	/** False when the shelf prices (MRP, company currency) do not apply. */
	applies(price_list, foreign_currency) {
		return !foreign_currency && (!this.price_list || !price_list || price_list === this.price_list);
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

	/** Load if never loaded or older than `max_age` ms (default: the refresh interval). */
	ensure(max_age) {
		if (Date.now() - this.loaded_at < (max_age || this.REFRESH_MS)) return Promise.resolve();
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
	 * One picker at a time on the whole page: a key press must answer one copy.
	 */
	pick(title, prices) {
		const turn = (this.pick_chain || Promise.resolve()).then(() => this._pick_now(title, prices));
		this.pick_chain = turn.catch(() => null);
		return turn;
	},

	_pick_now(title, prices) {
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

			// Keys are read on the whole page (capture phase): the POS moves the
			// cursor back to its search box whenever an item is added, which a
			// scan made while the picker is open does.
			let last_key_at = 0,
				pending = null;
			const on_key = (e) => {
				const now = Date.now(),
					burst = now - last_key_at < 50;
				last_key_at = now;
				if (e.key === "Escape" && !burst) {
					e.preventDefault();
					e.stopPropagation();
					finish(null);
					return;
				}
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
			};
			// Keep the cursor in the picker while it is open: no button has focus,
			// so a scanner's Enter cannot press one, and nothing types into the
			// search box behind it.
			const content = d.$wrapper.find(".modal-content").attr("tabindex", "-1");
			const keep_focus = (e) => {
				if (!d.$wrapper[0].contains(e.target)) content.trigger("focus");
			};
			document.addEventListener("keydown", on_key, true);
			document.addEventListener("focusin", keep_focus, true);
			d.onhide = () => {
				clearTimeout(pending);
				document.removeEventListener("keydown", on_key, true);
				document.removeEventListener("focusin", keep_focus, true);
				if (!done) {
					done = true;
					resolve(null);
				}
			};
			d.show();
			setTimeout(() => content.trigger("focus"), 50);
		});
	},

	// ---- desk Sales Invoice ------------------------------------------------

	/** Shelf prices are MRPs in company currency on the default selling list. */
	desk_applies(frm) {
		return this.applies(frm.doc.selling_price_list, flt(frm.doc.conversion_rate || 1) !== 1);
	},

	target_rate(row) {
		return flt(row.custom_shelf_price) * (flt(row.conversion_factor) || 1);
	},

	/** True while the row's price list rate is its shelf price. */
	on_shelf_price(row) {
		return Math.abs(flt(row.price_list_rate) - this.target_rate(row)) < 0.005;
	},

	/**
	 * The discount the row is meant to have. ERPNext rewrites discount_percentage
	 * directly (no event) while it re-prices a row after a quantity change, so
	 * only real changes count: a discount_percentage / discount_amount event, or
	 * a rate typed by hand (outside a re-price) below the shelf price.
	 */
	remember_discount(row) {
		if (flt(row.custom_shelf_price)) row.__shelf_discount = flt(row.discount_percentage);
	},

	repricing(row) {
		row.__shelf_burst = Date.now();
	},

	/** Keep price_list_rate on the chosen shelf price whatever ERPNext fetched. */
	keep_price(frm, cdt, cdn) {
		const row = locals[cdt] && locals[cdt][cdn];
		if (!row || !flt(row.custom_shelf_price) || frm.doc.docstatus !== 0) return;
		if (!this.on_shelf_price(row)) {
			this.repricing(row);
			if (row.__shelf_discount !== undefined) row.discount_percentage = row.__shelf_discount;
			// ERPNext keeps a discount AMOUNT when the price changes (and turns it
			// into a new percentage): clear it so it is worked out from the percentage.
			if (flt(row.discount_percentage)) row.discount_amount = 0;
			frappe.model.set_value(cdt, cdn, "price_list_rate", this.target_rate(row));
		}
		this.settle_later(frm, cdt, cdn);
	},

	/**
	 * Once the events of a re-price have stopped, put the row back on its shelf
	 * price less its discount, with no "margin" (ERPNext books one whenever the
	 * rate it holds is above the price list rate; here that would mean selling
	 * above the printed price).
	 */
	settle_later(frm, cdt, cdn) {
		const row = locals[cdt] && locals[cdt][cdn];
		if (!row || !flt(row.custom_shelf_price)) return;
		clearTimeout(row.__shelf_settle);
		row.__shelf_settle = setTimeout(() => this.settle(frm, cdt, cdn), 700);
	},

	settle(frm, cdt, cdn) {
		const row = locals[cdt] && locals[cdt][cdn];
		if (!row || !flt(row.custom_shelf_price) || frm.doc.docstatus !== 0) return;
		const target = this.target_rate(row);
		const pct = row.__shelf_discount !== undefined ? row.__shelf_discount : flt(row.discount_percentage);
		const want = flt(target * (1 - pct / 100), precision("rate", row));
		const margin = row.margin_type && flt(row.margin_rate_or_amount);
		if (!margin && this.on_shelf_price(row) && Math.abs(flt(row.discount_percentage) - pct) < 0.001 && Math.abs(flt(row.rate) - want) < 0.01) {
			return;
		}
		row.margin_type = "";
		row.margin_rate_or_amount = 0;
		row.rate_with_margin = 0;
		row.discount_percentage = pct;
		row.discount_amount = 0;
		row.price_list_rate = target;
		frm.script_manager.trigger("price_list_rate", cdt, cdn);
	},

	on_rate(frm, cdt, cdn) {
		const row = locals[cdt] && locals[cdt][cdn];
		if (!row || !flt(row.custom_shelf_price) || frm.doc.docstatus !== 0) return;
		setTimeout(() => {
			const target = this.target_rate(row);
			// A rate typed by hand (no re-price running) below the shelf price
			// becomes the row's discount.
			if (Date.now() - (row.__shelf_burst || 0) > 1500 && this.on_shelf_price(row) && flt(row.rate) <= target + 0.005 && target) {
				row.__shelf_discount = flt((1 - flt(row.rate) / target) * 100, 6);
			}
			this.settle_later(frm, cdt, cdn);
		}, 0);
	},

	/**
	 * The desk barcode scanner adds a scan to an existing row of the same item.
	 * For an item on the shelf at several prices, only a row at the scanned
	 * copy's price may take it; otherwise a new row is made (and the picker
	 * asks for the price when the barcode does not say).
	 */
	patch_desk_scanner() {
		const Scanner = window.erpnext && erpnext.utils && erpnext.utils.BarcodeScanner;
		if (!Scanner || Scanner.prototype.__trustbit_shelf) return;
		const original = Scanner.prototype.get_row_to_modify_on_scan;
		Scanner.prototype.get_row_to_modify_on_scan = function (item_code, batch_no, uom, barcode) {
			// Only tables whose rows carry a shelf price (Sales Invoice); every
			// other form keeps ERPNext's own matching.
			const grid = this.frm.fields_dict[this.items_table_name] && this.frm.fields_dict[this.items_table_name].grid;
			if (!grid || !frappe.meta.has_field(grid.doctype, "custom_shelf_price") || !trustbit_shelf.desk_applies(this.frm)) {
				return original.apply(this, arguments);
			}
			const shelf = trustbit_shelf;
			const bound = shelf.price_for_barcode(barcode);
			const price = bound && bound.item_code === item_code ? bound.price : null;
			if (price === null && shelf.prices_for(item_code).length < 2) {
				return original.apply(this, arguments);
			}
			const rows = (this.frm.doc[this.items_table_name] || []).filter(
				(r) => r.item_code === item_code && !(price !== null && Math.abs(flt(r.custom_shelf_price) - price) < 0.005)
			);
			// `has_item_scanned` rows are skipped by ERPNext's own matching.
			const saved = rows.map((r) => r.has_item_scanned);
			rows.forEach((r) => (r.has_item_scanned = 1));
			try {
				return original.apply(this, arguments);
			} finally {
				rows.forEach((r, i) => (r.has_item_scanned = saved[i]));
			}
		};
		Scanner.prototype.__trustbit_shelf = true;
	},

	set_choice(frm, cdt, cdn, price) {
		return frappe.model
			.set_value(cdt, cdn, "custom_shelf_price", price)
			.then(() => this.keep_price(frm, cdt, cdn));
	},

	remove_row(frm, cdn, item_label) {
		const grid = frm.fields_dict.items && frm.fields_dict.items.grid;
		const grid_row = grid && grid.get_row(cdn);
		if (grid_row) grid_row.remove();
		frappe.show_alert(
			{ message: __("{0} removed: choose the price printed on the copy.", [item_label]), indicator: "orange" },
			6
		);
	},

	on_item_code(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (frm.doc.docstatus !== 0) return;
		if (flt(row.custom_shelf_price)) frappe.model.set_value(cdt, cdn, "custom_shelf_price", 0);
		delete row.__shelf_discount;
		const item_code = row.item_code;
		if (!item_code || !this.desk_applies(frm)) return;
		// The desk scanner may set the barcode just after the item.
		setTimeout(async () => {
			const r = locals[cdt] && locals[cdt][cdn];
			if (!r || r.item_code !== item_code || flt(r.custom_shelf_price)) return;
			await this.ensure(30000);
			const bound = this.price_for_barcode(r.barcode);
			if (bound && bound.item_code === item_code) {
				return this.set_choice(frm, cdt, cdn, bound.price);
			}
			const prices = this.prices_for(item_code);
			if (prices.length < 2) return;
			const price = await this.pick(r.item_name || item_code, prices);
			const now = locals[cdt] && locals[cdt][cdn];
			if (!now || now.item_code !== item_code) return;
			if (price) {
				this.set_choice(frm, cdt, cdn, price);
			} else {
				// Esc: the row would otherwise stay at the newest (highest) price.
				this.remove_row(frm, cdn, r.item_name || item_code);
			}
		}, 300);
	},
};

window.trustbit_shelf = trustbit_shelf;

frappe.ui.form.on("Sales Invoice", {
	onload(frm) {
		trustbit_shelf.patch_desk_scanner();
		trustbit_shelf.ensure();
	},
	refresh(frm) {
		if (frm.doc.docstatus === 0) trustbit_shelf.ensure();
	},
});

frappe.ui.form.on("Sales Invoice Item", {
	item_code(frm, cdt, cdn) {
		trustbit_shelf.on_item_code(frm, cdt, cdn);
	},
	price_list_rate(frm, cdt, cdn) {
		trustbit_shelf.keep_price(frm, cdt, cdn);
	},
	rate(frm, cdt, cdn) {
		trustbit_shelf.on_rate(frm, cdt, cdn);
	},
	discount_percentage(frm, cdt, cdn) {
		trustbit_shelf.remember_discount(locals[cdt][cdn]);
		trustbit_shelf.settle_later(frm, cdt, cdn);
	},
	discount_amount(frm, cdt, cdn) {
		// ERPNext works the percentage out from the amount first.
		setTimeout(() => {
			trustbit_shelf.remember_discount(locals[cdt][cdn]);
			trustbit_shelf.settle_later(frm, cdt, cdn);
		}, 0);
	},
	qty(frm, cdt, cdn) {
		trustbit_shelf.repricing(locals[cdt][cdn]);
		trustbit_shelf.settle_later(frm, cdt, cdn);
	},
	uom(frm, cdt, cdn) {
		trustbit_shelf.repricing(locals[cdt][cdn]);
		trustbit_shelf.settle_later(frm, cdt, cdn);
	},
	conversion_factor(frm, cdt, cdn) {
		trustbit_shelf.keep_price(frm, cdt, cdn);
	},
});

frappe.ui.form.on("Item", {
	refresh(frm) {
		// Our own message block next to frappe's: ERPNext's Item refresh calls
		// frm.set_intro() with no text, which empties frappe's shared one, and the
		// form is reused from item to item — so hide ours first on every refresh.
		let box = $(frm.wrapper).find("[data-trustbit-shelf]");
		if (!box.length && frm.layout && frm.layout.message) {
			box = $('<div class="form-message-container hidden" data-trustbit-shelf></div>').insertAfter(
				frm.layout.message
			);
		}
		box.addClass("hidden").empty();
		if (frm.is_new()) return;
		const item_code = frm.doc.name;
		trustbit_shelf.ensure().then(() => {
			if (frm.doc.name !== item_code) return;
			const prices = trustbit_shelf.prices_for(item_code);
			if (!prices.length) return;
			const list = prices
				.map((p) => format_currency(p.price) + (p.barcode ? ` (${frappe.utils.escape_html(p.barcode)})` : ""))
				.join(" · ");
			const text = __("On the shelf at: {0}. Untick a price in {1} when its copies are gone.", [
				list,
				`<a href="/app/shelf-price?item_code=${encodeURIComponent(item_code)}&active=1">${__("Shelf Price")}</a>`,
			]);
			box.html(`<div class="form-message blue">${text}</div>`).removeClass("hidden");
		});
	},
});
