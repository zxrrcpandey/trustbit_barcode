// Copyright (c) 2026, Trustbit and contributors
// For license information, please see license.txt

frappe.ui.form.on("Shelf Price", {
	refresh(frm) {
		if (!frm.is_new() && !frm.doc.barcode && frm.perm[0] && frm.perm[0].write) {
			frm.add_custom_button(__("Make Barcode"), () => {
				frm.call("make_barcode").then(() => frm.reload_doc());
			});
		}
		if (!frm.is_new()) {
			frm.add_custom_button(__("Open Item"), () => frappe.set_route("Form", "Item", frm.doc.item_code));
		}
	},
});
