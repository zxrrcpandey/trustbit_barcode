/**
 * Trustbit Advance Barcode Print v1.0.1
 * Direct thermal barcode label printing from ERPNext with QZ Tray
 * 
 * Copyright (c) 2025 Trustbit
 * License: MIT
 */

var trustbit_barcode = {
    config: {
        printer_name: "Bar Code Printer TT065-50",
        label_sizes: {
            "35x15": { width: 70, height: 15, gap: 3, printable_height: 10 },
            "35x21": { width: 70, height: 21, gap: 3, printable_height: 10 },
            "38x25": { width: 76, height: 25, gap: 2, printable_height: 20 }
        },
        default_size: "35x15",
        left_label_x: 8,
        right_label_x: 305
    },

    show_barcode_dialog: function(frm) {
        let item_codes = frm.doc.items.map(item => item.item_code);
        
        console.log("=== TRUSTBIT BARCODE DEBUG ===");
        console.log("Item codes:", item_codes);
        
        // Fetch barcodes AND standard selling rates from Item master
        frappe.call({
            method: "trustbit_barcode.api.get_item_details",
            args: { item_codes: JSON.stringify(item_codes) },
            callback: function(r) {
                console.log("API Response:", r);
                let item_details = r.message || {};
                
                let items = frm.doc.items.map(item => {
                    let details = item_details[item.item_code] || {};
                    let barcode = details.barcode || item.item_code;
                    let rate = details.standard_rate || 0;
                    
                    console.log(item.item_code + " => Barcode: " + barcode + ", Selling Rate: " + rate);
                    
                    return {
                        item_code: item.item_code,
                        item_name: item.item_name,
                        qty: item.qty,
                        rate: rate,  // Use standard selling rate from Item master
                        barcode: barcode
                    };
                });
                
                trustbit_barcode.create_dialog(frm, items);
            },
            error: function(err) {
                console.error("Error fetching item details:", err);
                frappe.msgprint("Error fetching item details. Please try again.");
            }
        });
    },

    create_dialog: function(frm, items) {
        let fields = [
            {
                fieldname: "label_size",
                fieldtype: "Select",
                label: "Label Size",
                options: "35x15\n35x21\n38x25",
                default: this.config.default_size
            },
            { fieldtype: "Section Break", label: "Select Items to Print" },
            { fieldname: "select_all_btn", fieldtype: "Button", label: "Select All" },
            { fieldtype: "Section Break" }
        ];
        
        items.forEach((item, idx) => {
            fields.push({ fieldtype: "Check", fieldname: "check_" + idx, label: item.item_name.substring(0, 30), default: 1 });
            fields.push({ fieldtype: "Column Break" });
            fields.push({ fieldtype: "Data", fieldname: "barcode_" + idx, label: "Barcode", default: item.barcode, read_only: 1 });
            fields.push({ fieldtype: "Column Break" });
            fields.push({ fieldtype: "Currency", fieldname: "rate_" + idx, label: "Selling Rate", default: item.rate, read_only: 1 });
            fields.push({ fieldtype: "Column Break" });
            fields.push({ fieldtype: "Int", fieldname: "qty_" + idx, label: "Print Qty", default: item.qty || 1 });
            fields.push({ fieldtype: "Section Break" });
        });
        
        let d = new frappe.ui.Dialog({
            title: __("Print Barcode Labels"),
            fields: fields,
            size: "large",
            primary_action_label: __("Print Barcodes"),
            primary_action: function(values) {
                let selected = [];
                items.forEach((item, idx) => {
                    if (values["check_" + idx]) {
                        selected.push({
                            item_code: item.item_code,
                            item_name: item.item_name,
                            barcode: values["barcode_" + idx],
                            rate: values["rate_" + idx],
                            print_qty: values["qty_" + idx] || 1
                        });
                    }
                });
                
                if (!selected.length) {
                    frappe.msgprint(__("Please select at least one item"));
                    return;
                }
                
                d.hide();
                trustbit_barcode.print_via_qz(values.label_size, selected, frm.doc.name);
            }
        });
        
        d.$wrapper.find("[data-fieldname=select_all_btn]").on("click", function() {
            items.forEach((item, idx) => d.set_value("check_" + idx, 1));
        });
        
        d.show();
    },

    print_via_qz: function(label_size, items, doc_name) {
        if (typeof qz === "undefined") {
            frappe.msgprint({
                title: __("QZ Tray Not Found"),
                message: __("QZ Tray is not loaded. Please ensure QZ Tray is running and refresh the page."),
                indicator: "red"
            });
            return;
        }
        
        frappe.show_alert({ message: __("Connecting to QZ Tray..."), indicator: "blue" });
        
        let connectPromise = qz.websocket.isActive() ? Promise.resolve() : qz.websocket.connect();
        
        connectPromise.then(function() {
            frappe.show_alert({ message: __("Printing..."), indicator: "blue" });
            let tspl = trustbit_barcode.generate_tspl(label_size, items);
            console.log("TSPL Commands:", tspl);
            let config = qz.configs.create(trustbit_barcode.config.printer_name);
            return qz.print(config, [{ type: "raw", format: "command", data: tspl }]);
        }).then(function() {
            frappe.show_alert({ message: __("Printed successfully: " + doc_name), indicator: "green" });
        }).catch(function(err) {
            console.error("QZ Tray Error:", err);
            frappe.msgprint({ title: __("Print Error"), message: __("Error: " + (err.message || err)), indicator: "red" });
        });
    },

    generate_tspl: function(label_size, items) {
        let size_config = this.config.label_sizes[label_size] || this.config.label_sizes["35x15"];
        
        let cmds = [
            "SIZE " + size_config.width + " mm, " + size_config.height + " mm",
            "GAP " + size_config.gap + " mm, 0 mm",
            "SPEED 4",
            "DENSITY 8",
            "DIRECTION 1",
            ""
        ];
        
        let labels = [];
        items.forEach(item => {
            let qty = parseInt(item.print_qty) || 1;
            for (let i = 0; i < qty; i++) {
                labels.push({
                    name: item.item_name || "",
                    barcode: item.barcode,
                    rate: item.rate || 0,
                    item_code: item.item_code || ""
                });
            }
        });
        
        for (let i = 0; i < labels.length; i += 2) {
            cmds.push("CLS");
            
            let l1 = labels[i];
            let name1 = this.escape_text(l1.name.substring(0, 14));
            let rate1 = parseFloat(l1.rate).toFixed(0);
            
            cmds.push('TEXT ' + this.config.left_label_x + ',2,"1",0,1,1,"' + name1 + '"');
            cmds.push('BARCODE ' + this.config.left_label_x + ',16,"128",60,0,0,2,4,"' + l1.barcode + '"');
            cmds.push('TEXT ' + this.config.left_label_x + ',80,"1",0,1,1,"' + l1.barcode + '"');
            cmds.push('TEXT ' + this.config.left_label_x + ',96,"1",0,1,1,"' + l1.item_code + ' Rs' + rate1 + '"');
            
            if (i + 1 < labels.length) {
                let l2 = labels[i + 1];
                let name2 = this.escape_text(l2.name.substring(0, 14));
                let rate2 = parseFloat(l2.rate).toFixed(0);
                
                cmds.push('TEXT ' + this.config.right_label_x + ',2,"1",0,1,1,"' + name2 + '"');
                cmds.push('BARCODE ' + this.config.right_label_x + ',16,"128",60,0,0,2,4,"' + l2.barcode + '"');
                cmds.push('TEXT ' + this.config.right_label_x + ',80,"1",0,1,1,"' + l2.barcode + '"');
                cmds.push('TEXT ' + this.config.right_label_x + ',96,"1",0,1,1,"' + l2.item_code + ' Rs' + rate2 + '"');
            }
            
            cmds.push("PRINT 1");
            cmds.push("");
        }
        
        return cmds.join("\n");
    },

    escape_text: function(text) {
        if (!text) return "";
        return text.replace(/"/g, "'").replace(/\\/g, "");
    }
};

frappe.ui.form.on("Purchase Invoice", {
    refresh: function(frm) {
        if (frm.doc.docstatus === 1) {
            frm.add_custom_button(__("Print Barcode Labels"), function() {
                trustbit_barcode.show_barcode_dialog(frm);
            }, __("Create"));
        }
    }
});

frappe.ui.form.on("Sales Invoice", {
    refresh: function(frm) {
        if (frm.doc.docstatus === 1) {
            frm.add_custom_button(__("Print Barcode Labels"), function() {
                trustbit_barcode.show_barcode_dialog(frm);
            }, __("Create"));
        }
    }
});

frappe.ui.form.on("Stock Entry", {
    refresh: function(frm) {
        if (frm.doc.docstatus === 1) {
            frm.add_custom_button(__("Print Barcode Labels"), function() {
                trustbit_barcode.show_barcode_dialog(frm);
            }, __("Create"));
        }
    }
});

console.log("Trustbit Advance Barcode Print v1.0.1 loaded");