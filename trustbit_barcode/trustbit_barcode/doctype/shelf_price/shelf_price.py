# Copyright (c) 2026, Trustbit and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt

from trustbit_barcode.shelf_prices import (
	add_item_barcode,
	default_price_list,
	next_shop_barcode,
	same_price,
)


class ShelfPrice(Document):
	def validate(self):
		if flt(self.price) <= 0:
			frappe.throw(_("Printed Price must be more than zero"))
		self.price_list = self.price_list or default_price_list()
		self.barcode = (self.barcode or "").strip() or None

		for other in frappe.get_all(
			"Shelf Price",
			filters={"item_code": self.item_code, "price_list": self.price_list, "name": ("!=", self.name)},
			fields=["name", "price"],
		):
			if same_price(other.price, self.price):
				frappe.throw(
					_("{0} already has a shelf price of {1}: {2}").format(
						self.item_code, frappe.format_value(self.price, "Currency"), other.name
					)
				)

		if self.barcode:
			owner = frappe.db.get_value("Item Barcode", {"barcode": self.barcode}, "parent")
			if owner and owner != self.item_code:
				frappe.throw(_("Barcode {0} belongs to item {1}").format(self.barcode, owner))
			taken = frappe.db.get_value(
				"Shelf Price", {"barcode": self.barcode, "name": ("!=", self.name)}, "name"
			)
			if taken:
				frappe.throw(_("Barcode {0} is already used by {1}").format(self.barcode, taken))

	def on_update(self):
		if self.barcode:
			add_item_barcode(self.item_code, self.barcode)

	@frappe.whitelist()
	def make_barcode(self):
		"""Give this price its own shop barcode (next free 1xxxxx number)."""
		self.check_permission("write")
		if self.barcode:
			return self.barcode
		self.barcode = next_shop_barcode()
		self.save()
		return self.barcode
