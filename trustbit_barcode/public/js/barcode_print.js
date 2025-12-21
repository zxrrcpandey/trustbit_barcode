/**
* Trustbit Barcode Print v1.0.6
* Direct thermal barcode label printing from ERPNext with QZ Tray
* Copyright (c) 2025 Trustbit - MIT License
* 
* New in v1.0.6:
* - Configurable horizontal gaps (left margin, middle gap, right margin)
* - Configurable Y positions for all elements
* - Configurable barcode dimensions
* - Auto-calculate label positions from margins
*/

var trustbit_barcode = {
    settings: null,
    
    load_settings: function(callback) {
        if (this.settings) {
            callback(this.settings);
            return;
        }
        
        frappe.call({
            method: "trustbit_barcode.api.get_barcode_print_settings",
            async: false,
            callback: (r) => {
                this.settings = r.message || this.get_default_settings();
                callback(this.settings);
            },
            error: () => {
                this.settings = this.get_default_settings();
                callback(this.settings);
            }
        });
    },
    
    get_default_settings: function() {
        return {
            default_printer: "Bar Code Printer TT065-50",
            default_price_list: "Standard Selling",
            default_label_size: "35x15mm 2-up",
            label_sizes: [{
                name: "35x15mm 2-up",
                printer_name: "Bar Code Printer TT065-50",
                width: 70, height: 15, gap: 3,
                labels_per_row: 2, printable_height: 10,
                // Horizontal gaps
                left_margin: 8,
                middle_gap: 16,
                right_margin: 8,
                left_label_x: 8, 
                right_label_x: 305,
                // Barcode settings
                barcode_width: 2,
                barcode_height: 60,
                // Y positions
                name_y: 2,
                barcode_y: 16,
                barcode_text_y: 80,
                price_y: 96,
                // Text settings
                text_max_chars: 14,
                // Print settings
                speed: 4, density: 8, is_default: true
            }]
        };
    },

    show_barcode_dialog: function(frm) {
        let self = this;
        
        this.load_settings(function(settings) {
            let item_codes = frm.doc.items.map(item => item.item_code);
            
            console.log("=== TRUSTBIT BARCODE v1.0.6 ===");
            console.log("Settings:", settings);
            
            frappe.call({
                method: "trustbit_barcode.api.get_item_details",
                args: {
                    item_codes: JSON.stringify(item_codes),
                    price_list: settings.default_price_list
                },
                callback: function(r) {
                    let item_details = r.message || {};
                    
                    let items = frm.doc.items.map(item => {
                        let details = item_details[item.item_code] || {};
                        return {
                            item_code: item.item_code,
                            item_name: item.item_name,
                            qty: item.qty,
                            rate: details.selling_rate || 0,
                            barcode: details.barcode || item.item_code
                        };
                    });
                    
                    self.create_dialog(frm, items, settings);
                }
            });
        });
    },

    create_dialog: function(frm, items, settings) {
        let self = this;
        
        let label_options = settings.label_sizes.map(s => s.name).join("\n");
        let default_size = settings.default_label_size || settings.label_sizes[0]?.name;
        
        let fields = [
            {
                fieldname: "label_size",
                fieldtype: "Select",
                label: "Label Size",
                options: label_options,
                default: default_size,
                reqd: 1
            },
            { fieldtype: "Section Break", label: "Select Items to Print" },
            { fieldname: "select_all_btn", fieldtype: "Button", label: "Select All" },
            { fieldname: "deselect_all_btn", fieldtype: "Button", label: "Deselect All" },
            { fieldtype: "Section Break" }
        ];
        
        items.forEach((item, idx) => {
            fields.push({ fieldtype: "Check", fieldname: "check_" + idx, label: item.item_name.substring(0, 30), default: 1 });
            fields.push({ fieldtype: "Column Break" });
            fields.push({ fieldtype: "Data", fieldname: "barcode_" + idx, label: "Barcode", default: item.barcode, read_only: 1 });
            fields.push({ fieldtype: "Column Break" });
            fields.push({ fieldtype: "Currency", fieldname: "rate_" + idx, label: "Rate (₹)", default: item.rate });
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
                
                let size_config = settings.label_sizes.find(s => s.name === values.label_size) || settings.label_sizes[0];
                
                d.hide();
                self.print_via_qz(size_config, selected, frm.doc.name);
            }
        });
        
        d.$wrapper.find("[data-fieldname=select_all_btn]").on("click", function() {
            items.forEach((item, idx) => d.set_value("check_" + idx, 1));
        });
        
        d.$wrapper.find("[data-fieldname=deselect_all_btn]").on("click", function() {
            items.forEach((item, idx) => d.set_value("check_" + idx, 0));
        });
        
        d.show();
    },

    print_via_qz: function(size_config, items, doc_name) {
        let self = this;
        
        if (typeof qz === "undefined") {
            frappe.msgprint({
                title: __("QZ Tray Not Found"),
                message: __("Please ensure QZ Tray is running and refresh the page."),
                indicator: "red"
            });
            return;
        }
        
        frappe.show_alert({ message: __("Connecting..."), indicator: "blue" });
        
        let connectPromise = qz.websocket.isActive() ? Promise.resolve() : qz.websocket.connect();
        
        connectPromise.then(function() {
            frappe.show_alert({ message: __("Printing to " + size_config.printer_name), indicator: "blue" });
            
            let tspl = self.generate_tspl(size_config, items);
            console.log("TSPL Commands:", tspl);
            
            let config = qz.configs.create(size_config.printer_name);
            return qz.print(config, [{ type: "raw", format: "command", data: tspl }]);
            
        }).then(function() {
            frappe.show_alert({ message: __("Printed: " + doc_name), indicator: "green" });
        }).catch(function(err) {
            console.error("QZ Error:", err);
            frappe.msgprint({ title: __("Print Error"), message: String(err), indicator: "red" });
        });
    },

    generate_tspl: function(size_config, items) {
        // Get configuration values with defaults
        let cfg = {
            width: size_config.width || 70,
            height: size_config.height || 15,
            gap: size_config.gap || 3,
            speed: size_config.speed || 4,
            density: size_config.density || 8,
            
            // Horizontal positioning
            left_margin: size_config.left_margin || 8,
            middle_gap: size_config.middle_gap || 16,
            right_margin: size_config.right_margin || 8,
            left_label_x: size_config.left_label_x || 8,
            right_label_x: size_config.right_label_x || 305,
            
            // Barcode settings
            barcode_width: size_config.barcode_width || 2,
            barcode_height: size_config.barcode_height || 60,
            
            // Y positions
            name_y: size_config.name_y || 2,
            barcode_y: size_config.barcode_y || 16,
            barcode_text_y: size_config.barcode_text_y || 80,
            price_y: size_config.price_y || 96,
            
            // Text settings
            text_max_chars: size_config.text_max_chars || 14,
            
            // Layout
            labels_per_row: size_config.labels_per_row || 2
        };
        
        // If left_label_x is not explicitly set, calculate from left_margin
        if (!size_config.left_label_x && size_config.left_margin) {
            cfg.left_label_x = cfg.left_margin;
        }
        
        // Log configuration for debugging
        console.log("Label Config:", cfg);
        
        let cmds = [
            "SIZE " + cfg.width + " mm, " + cfg.height + " mm",
            "GAP " + cfg.gap + " mm, 0 mm",
            "SPEED " + cfg.speed,
            "DENSITY " + cfg.density,
            "DIRECTION 1",
            ""
        ];
        
        // Build label array with quantities expanded
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
        
        let per_row = cfg.labels_per_row;
        
        // Generate TSPL for each row of labels
        for (let i = 0; i < labels.length; i += per_row) {
            cmds.push("CLS");
            
            // Left label
            let l1 = labels[i];
            let name1 = this.escape_text(l1.name.substring(0, cfg.text_max_chars));
            let rate1 = parseFloat(l1.rate).toFixed(0);
            let x1 = cfg.left_label_x;
            
            cmds.push('TEXT ' + x1 + ',' + cfg.name_y + ',"1",0,1,1,"' + name1 + '"');
            cmds.push('BARCODE ' + x1 + ',' + cfg.barcode_y + ',"128",' + cfg.barcode_height + ',0,0,' + cfg.barcode_width + ',4,"' + l1.barcode + '"');
            cmds.push('TEXT ' + x1 + ',' + cfg.barcode_text_y + ',"1",0,1,1,"' + l1.barcode + '"');
            cmds.push('TEXT ' + x1 + ',' + cfg.price_y + ',"1",0,1,1,"' + l1.item_code + ' Rs' + rate1 + '"');
            
            // Right label (if 2-up and more labels exist)
            if (per_row >= 2 && i + 1 < labels.length) {
                let l2 = labels[i + 1];
                let name2 = this.escape_text(l2.name.substring(0, cfg.text_max_chars));
                let rate2 = parseFloat(l2.rate).toFixed(0);
                let x2 = cfg.right_label_x;
                
                cmds.push('TEXT ' + x2 + ',' + cfg.name_y + ',"1",0,1,1,"' + name2 + '"');
                cmds.push('BARCODE ' + x2 + ',' + cfg.barcode_y + ',"128",' + cfg.barcode_height + ',0,0,' + cfg.barcode_width + ',4,"' + l2.barcode + '"');
                cmds.push('TEXT ' + x2 + ',' + cfg.barcode_text_y + ',"1",0,1,1,"' + l2.barcode + '"');
                cmds.push('TEXT ' + x2 + ',' + cfg.price_y + ',"1",0,1,1,"' + l2.item_code + ' Rs' + rate2 + '"');
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

// Register handlers for Purchase Invoice
frappe.ui.form.on("Purchase Invoice", {
    refresh: function(frm) {
        if (frm.doc.docstatus === 1) {
            frm.add_custom_button(__("Print Barcode Labels"), function() {
                trustbit_barcode.show_barcode_dialog(frm);
            }, __("Create"));
        }
    }
});

// Register handlers for Sales Invoice
frappe.ui.form.on("Sales Invoice", {
    refresh: function(frm) {
        if (frm.doc.docstatus === 1) {
            frm.add_custom_button(__("Print Barcode Labels"), function() {
                trustbit_barcode.show_barcode_dialog(frm);
            }, __("Create"));
        }
    }
});

// Register handlers for Stock Entry
frappe.ui.form.on("Stock Entry", {
    refresh: function(frm) {
        if (frm.doc.docstatus === 1) {
            frm.add_custom_button(__("Print Barcode Labels"), function() {
                trustbit_barcode.show_barcode_dialog(frm);
            }, __("Create"));
        }
    }
});

console.log("Trustbit Barcode v1.0.6 loaded");