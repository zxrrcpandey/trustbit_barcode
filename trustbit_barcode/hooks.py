app_name = "trustbit_barcode"
app_title = "Trustbit Barcode"
app_publisher = "Trustbit"
app_description = "Direct thermal barcode label printing from ERPNext with QZ Tray"
app_email = "ra.pandey008@gmail.com"
app_license = "mit"
app_version = "1.1.1"

required_apps = ["erpnext"]

# Production serves /assets with a one-year cache and these files are not
# fingerprinted: bump ?v= on EVERY change or browsers keep the old copy.
app_include_js = [
    "/assets/trustbit_barcode/js/qz-tray.js",
    "/assets/trustbit_barcode/js/barcode_print.js?v=1.1.1",
    "/assets/trustbit_barcode/js/shelf_prices.js?v=1.1.1"
]

# Create default settings after install
after_install = "trustbit_barcode.install.after_install"

# Shelf prices (v1.1.0): a receipt line's "Selling Price on Pack (MRP)" changes
# the selling price on submit (Purchase Receipt, or Purchase Invoice with Update
# Stock) and keeps an older price for the copies already on the shelf — see
# shelf_prices.py.
doc_events = {
    "Purchase Receipt": {
        "validate": "trustbit_barcode.shelf_prices.preview_on_save",
        "on_submit": "trustbit_barcode.shelf_prices.apply_on_submit",
        "on_cancel": "trustbit_barcode.shelf_prices.warn_on_cancel",
    },
    "Purchase Invoice": {
        "validate": "trustbit_barcode.shelf_prices.preview_on_save",
        "on_submit": "trustbit_barcode.shelf_prices.apply_on_submit",
        "on_cancel": "trustbit_barcode.shelf_prices.warn_on_cancel",
    },
}

fixtures = [
    {
        "dt": "Custom Field",
        "filters": [
            [
                "name",
                "in",
                [
                    "Purchase Receipt Item-custom_pack_mrp",
                    "Purchase Receipt Item-custom_new_price_barcode",
                    "Purchase Receipt Item-custom_shelf_barcode",
                    "Purchase Invoice Item-custom_pack_mrp",
                    "Purchase Invoice Item-custom_new_price_barcode",
                    "Purchase Invoice Item-custom_shelf_barcode",
                    "Sales Invoice Item-custom_shelf_price",
                ],
            ]
        ],
    }
]
