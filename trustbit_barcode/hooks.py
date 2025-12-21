app_name = "trustbit_barcode"
app_title = "Trustbit Barcode"
app_publisher = "Trustbit"
app_description = "Direct thermal barcode label printing from ERPNext with QZ Tray"
app_email = "ra.pandey008@gmail.com"
app_license = "mit"
app_version = "1.0.7"

required_apps = ["erpnext"]

app_include_js = [
    "/assets/trustbit_barcode/js/qz-tray.js",
    "/assets/trustbit_barcode/js/barcode_print.js"
]

# Create default settings after install
after_install = "trustbit_barcode.install.after_install"
