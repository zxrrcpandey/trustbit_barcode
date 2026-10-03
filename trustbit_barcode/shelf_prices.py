# -*- coding: utf-8 -*-
# Copyright (c) 2026, Trustbit and contributors
# For license information, please see license.txt

"""
Shelf prices: one item, sold at more than one printed price at the same time.

When new stock arrives at a new printed price (MRP) while old stock is still on
the shelf, the shop used to create a second Item for the same product. Instead,
the receipt line carries "Selling Price on Pack (MRP)"; on submit:

- price UP:   the item's selling price becomes the new one, and the old price
              stays active as a shelf price for the copies already on the shelf
              (never sell a copy above the price printed on it);
- price DOWN: the new, lower price applies to every copy; active shelf prices
              above it are switched off (selling below the printed price is
              allowed), lower ones stay;
- optional "New Barcode for This Price": the price gets its own shop barcode
  (next free 1xxxxx number), added to the Item's barcodes, so scanning the new
  label sells at the new price.

The POS asks the cashier which price is printed on the copy whenever an item has
two or more active shelf prices and the scanned barcode does not decide it.
"""

import frappe
from frappe import _
from frappe.utils import cint, flt, fmt_money, getdate, nowdate

PRICE_FIELD = "custom_pack_mrp"
NEW_BARCODE_FIELD = "custom_new_price_barcode"
BARCODE_FIELD = "custom_shelf_barcode"

# Shop barcode labels are plain 6-digit numbers starting with 1 (100953 … 107919).
BARCODE_SERIES = "TB-SHELF-BARCODE"
SHOP_BARCODE_REGEX = "^1[0-9]{5}$"


def default_price_list():
	return frappe.db.get_single_value("Selling Settings", "selling_price_list") or "Standard Selling"


def same_price(a, b):
	return abs(flt(a, 2) - flt(b, 2)) < 0.005


# ---------------------------------------------------------------------------
# Lookups
# ---------------------------------------------------------------------------


def current_selling_price(item_code, price_list, on_date=None):
	"""The Item Price ERPNext would use today for the stock UOM: plain rows only
	(no customer / supplier / batch), valid on the date, newest valid_from first."""
	on_date = getdate(on_date or nowdate())
	stock_uom = frappe.db.get_value("Item", item_code, "stock_uom")
	rows = frappe.db.sql(
		"""
		SELECT price_list_rate
		FROM `tabItem Price`
		WHERE item_code = %(item)s AND price_list = %(pl)s
			AND IFNULL(customer, '') = '' AND IFNULL(supplier, '') = '' AND IFNULL(batch_no, '') = ''
			AND IFNULL(uom, '') IN ('', %(uom)s)
			AND (valid_from IS NULL OR valid_from <= %(d)s)
			AND (valid_upto IS NULL OR valid_upto >= %(d)s)
		ORDER BY valid_from IS NULL, valid_from DESC, IFNULL(uom, '') = '', creation DESC
		LIMIT 1
		""",
		{"item": item_code, "pl": price_list, "uom": stock_uom, "d": on_date},
	)
	return flt(rows[0][0]) if rows else None


def shelf_rows(item_code, price_list, active_only=True):
	filters = {"item_code": item_code, "price_list": price_list}
	if active_only:
		filters["active"] = 1
	return frappe.get_all(
		"Shelf Price",
		filters=filters,
		fields=["name", "price", "barcode", "active"],
		order_by="price asc",
	)


@frappe.whitelist()
def get_active_shelf_prices(price_list=None):
	"""Every active shelf price, grouped by item — for the POS (one small query,
	refreshed every few minutes, independent of the POS item catalogue)."""
	price_list = price_list or default_price_list()
	rows = frappe.db.sql(
		"""
		SELECT item_code, price, IFNULL(barcode, '') AS barcode
		FROM `tabShelf Price`
		WHERE active = 1 AND price_list = %s
		ORDER BY item_code, price
		""",
		price_list,
		as_dict=True,
	)
	by_item = {}
	for r in rows:
		by_item.setdefault(r.item_code, []).append({"price": flt(r.price), "barcode": r.barcode})
	return {"price_list": price_list, "by_item": by_item}


@frappe.whitelist()
def get_shelf_prices(item_code, price_list=None):
	"""Active shelf prices of one item (desk forms)."""
	price_list = price_list or default_price_list()
	return [
		{"name": r.name, "price": flt(r.price), "barcode": r.barcode or ""}
		for r in shelf_rows(item_code, price_list)
	]


# ---------------------------------------------------------------------------
# Barcodes
# ---------------------------------------------------------------------------


def next_shop_barcode():
	"""Next free shop barcode after the highest 1xxxxx number in use."""
	from frappe.model.naming import getseries

	if not frappe.db.sql("SELECT 1 FROM `tabSeries` WHERE name = %s", BARCODE_SERIES):
		start = frappe.db.sql(
			"SELECT MAX(CAST(barcode AS UNSIGNED)) FROM `tabItem Barcode` WHERE barcode REGEXP %s",
			SHOP_BARCODE_REGEX,
		)[0][0]
		frappe.db.sql(
			"INSERT IGNORE INTO `tabSeries` (name, current) VALUES (%s, %s)",
			(BARCODE_SERIES, cint(start) or 100000),
		)

	for _attempt in range(1000):
		code = getseries(BARCODE_SERIES, 6)
		if not frappe.db.exists("Item Barcode", {"barcode": code}):
			return code
	frappe.throw(_("Could not find a free shop barcode number"))


def add_item_barcode(item_code, barcode):
	"""Add `barcode` to the Item's barcode table, unless it is already there.
	Written as a child row so that saving the receipt never depends on the whole
	Item passing validation."""
	owner = frappe.db.get_value("Item Barcode", {"barcode": barcode}, "parent")
	if owner == item_code:
		return
	if owner:
		frappe.throw(_("Barcode {0} already belongs to item {1}").format(barcode, owner))

	idx = frappe.db.sql(
		"SELECT IFNULL(MAX(idx), 0) FROM `tabItem Barcode` WHERE parent = %s AND parenttype = 'Item'",
		item_code,
	)[0][0]
	frappe.get_doc(
		{
			"doctype": "Item Barcode",
			"parent": item_code,
			"parenttype": "Item",
			"parentfield": "barcodes",
			"idx": cint(idx) + 1,
			"barcode": barcode,
			"uom": frappe.db.get_value("Item", item_code, "stock_uom"),
		}
	).db_insert()
	frappe.clear_document_cache("Item", item_code)


# ---------------------------------------------------------------------------
# What a receipt line does
# ---------------------------------------------------------------------------


def plan_price_change(item_code, new_price, price_list):
	"""What a receipt line at `new_price` will change. Pure read; used for the
	draft preview and for the submit itself."""
	current = current_selling_price(item_code, price_list)
	active = shelf_rows(item_code, price_list)
	plan = frappe._dict(
		current=current,
		new_price=new_price,
		set_item_price=False,
		keep_old=None,
		deactivate=[],
		kind="none",
	)

	if current is None:
		plan.kind = "first"
		plan.set_item_price = True
	elif new_price > current and not same_price(new_price, current):
		plan.kind = "up"
		plan.set_item_price = True
		plan.keep_old = current
	elif new_price < current and not same_price(new_price, current):
		plan.kind = "down"
		plan.set_item_price = True
		plan.deactivate = [r for r in active if r.price > new_price and not same_price(r.price, new_price)]
	elif active:
		plan.kind = "same_shelf"
	return plan


def describe(item_label, plan, new_barcode=None, future=True):
	money = lambda v: fmt_money(v, currency="INR")
	will = (lambda a, b: a) if future else (lambda a, b: b)
	if plan.kind == "up":
		text = will(
			_("{0}: selling price {1} → {2}. {1} stays for the copies already on the shelf."),
			_("{0}: selling price is now {2}. {1} kept for the copies already on the shelf."),
		).format(item_label, money(plan.current), money(plan.new_price))
	elif plan.kind == "down":
		text = will(
			_("{0}: selling price {1} → {2} for every copy."),
			_("{0}: selling price is now {2} for every copy (was {1})."),
		).format(item_label, money(plan.current), money(plan.new_price))
	elif plan.kind == "first":
		text = _("{0}: selling price {1}.").format(item_label, money(plan.new_price))
	elif plan.kind == "same_shelf":
		text = _("{0}: {1} is already a shelf price.").format(item_label, money(plan.new_price))
	else:
		text = _("{0}: price unchanged ({1}).").format(item_label, money(plan.new_price))

	if plan.current and (plan.new_price > 2 * plan.current or plan.new_price < plan.current / 2):
		text += " <b>" + _("Check this price: it is far from the current one.") + "</b>"
	if new_barcode:
		text += " " + _("New barcode: {0}.").format(frappe.bold(new_barcode))
	return text


def _priced_rows(doc):
	if cint(doc.get("is_return")):
		return []
	return [
		row for row in doc.get("items") or []
		if row.get("item_code") and flt(row.get(PRICE_FIELD)) > 0
	]


def preview_on_save(doc, method=None):
	"""Draft save: show what submitting this receipt will do to selling prices."""
	if doc.docstatus != 0 or doc.flags.in_import:
		return
	rows = _priced_rows(doc)
	if not rows:
		return
	price_list = default_price_list()
	lines, seen = [], set()
	for row in rows:
		new_price = flt(row.get(PRICE_FIELD), 2)
		key = (row.item_code, new_price)
		if key in seen:
			continue
		seen.add(key)
		plan = plan_price_change(row.item_code, new_price, price_list)
		if plan.kind == "none" and not cint(row.get(NEW_BARCODE_FIELD)):
			continue
		text = describe(f"#{row.idx} {row.item_name or row.item_code}", plan)
		if cint(row.get(NEW_BARCODE_FIELD)):
			existing = next(
				(r.barcode for r in shelf_rows(row.item_code, price_list, active_only=False)
					if r.barcode and same_price(r.price, new_price)),
				None,
			)
			text += " " + (
				_("Labels use its barcode {0}.").format(existing)
				if existing
				else _("A new barcode will be made for this price.")
			)
		lines.append(text)
	if lines:
		frappe.msgprint(
			"<br>".join(lines),
			title=_("Selling prices change when you submit"),
			indicator="orange",
		)


def apply_on_submit(doc, method=None):
	rows = _priced_rows(doc)
	if not rows:
		return
	price_list = default_price_list()
	today = nowdate()
	lines = []
	for row in rows:
		label = f"#{row.idx} {row.item_name or row.item_code}"
		# A price problem must never stop the goods from being received: roll the
		# line back, log it, say so, and carry on.
		frappe.db.savepoint("shelf_price_row")
		try:
			text = _apply_row(doc, row, price_list, today)
		except Exception:
			frappe.db.rollback(save_point="shelf_price_row")
			frappe.log_error(title=f"Shelf price: {doc.doctype} {doc.name} row {row.idx}")
			text = "<span style='color: var(--red-600)'>" + _(
				"{0}: selling price NOT changed — an error was logged. Set it by hand."
			).format(label) + "</span>"
		if text:
			lines.append(text)

	if lines:
		if any(r.get(BARCODE_FIELD) for r in rows):
			lines.append(_("Print the labels from Create → Print Barcode Labels."))
		frappe.msgprint("<br>".join(lines), title=_("Selling prices updated"), indicator="green")


def _apply_row(doc, row, price_list, today):
	"""Apply one receipt line; returns the line for the summary message (or None)."""
	new_price = flt(row.get(PRICE_FIELD), 2)
	plan = plan_price_change(row.item_code, new_price, price_list)
	want_barcode = cint(row.get(NEW_BARCODE_FIELD))

	if plan.set_item_price:
		_set_item_price(row.item_code, price_list, new_price, today)
	if plan.keep_old is not None:
		_ensure_shelf_row(row.item_code, price_list, plan.keep_old, doc, today)
	for r in plan.deactivate:
		frappe.db.set_value("Shelf Price", r.name, "active", 0)

	# The new price needs its own shelf row when another price stays active,
	# or when the line asks for its own barcode.
	others_active = [
		r for r in shelf_rows(row.item_code, price_list) if not same_price(r.price, new_price)
	]
	shelf = None
	if others_active or want_barcode:
		shelf = _ensure_shelf_row(row.item_code, price_list, new_price, doc, today)

	new_barcode = None
	if shelf and want_barcode and not shelf.barcode:
		new_barcode = next_shop_barcode()
		add_item_barcode(row.item_code, new_barcode)
		shelf.db_set("barcode", new_barcode)
	if shelf and shelf.barcode and row.get(BARCODE_FIELD) != shelf.barcode:
		row.db_set(BARCODE_FIELD, shelf.barcode, update_modified=False)

	if plan.kind != "none" or new_barcode:
		return describe(f"#{row.idx} {row.item_name or row.item_code}", plan, new_barcode, future=False)


def _ensure_shelf_row(item_code, price_list, price, doc, on_date):
	"""Active Shelf Price row for item + price (reactivated if it exists)."""
	for r in shelf_rows(item_code, price_list, active_only=False):
		if same_price(r.price, price):
			row = frappe.get_doc("Shelf Price", r.name)
			if not row.active:
				row.db_set("active", 1)
			return row
	row = frappe.get_doc(
		{
			"doctype": "Shelf Price",
			"item_code": item_code,
			"price_list": price_list,
			"price": price,
			"active": 1,
			"source_doctype": doc.doctype,
			"source_name": doc.name,
			"received_on": doc.get("posting_date") or on_date,
		}
	)
	row.insert(ignore_permissions=True)
	return row


def _set_item_price(item_code, price_list, price, on_date):
	"""Make `price` the selling price from `on_date` on. Adds a dated Item Price
	row (older rows stay as history — the School Book Sales Report reads the
	price on its To Date), or updates today's row if there already is one."""
	stock_uom = frappe.db.get_value("Item", item_code, "stock_uom")
	for r in frappe.get_all(
		"Item Price",
		filters={"item_code": item_code, "price_list": price_list, "valid_from": on_date},
		fields=["name", "uom", "customer", "supplier", "batch_no", "valid_upto"],
	):
		if (r.uom or stock_uom) == stock_uom and not (r.customer or r.supplier or r.batch_no or r.valid_upto):
			ip = frappe.get_doc("Item Price", r.name)
			ip.price_list_rate = price
			ip.save(ignore_permissions=True)
			return ip
	ip = frappe.get_doc(
		{
			"doctype": "Item Price",
			"item_code": item_code,
			"price_list": price_list,
			"uom": stock_uom,
			"price_list_rate": price,
			"valid_from": on_date,
		}
	)
	ip.insert(ignore_permissions=True)
	return ip
