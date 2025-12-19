# Trustbit Barcode

Direct thermal barcode label printing from ERPNext with QZ Tray integration.

## Features

- Print barcode labels directly from Purchase Invoice, Sales Invoice, and Stock Entry
- Configurable label sizes for different thermal printers
- Fetches selling prices from Item Price table
- Supports 2-column label layouts
- Uses TSPL commands for thermal printers (TVS LP 46 Lite, TSC printers, etc.)
- Auto-configures default settings on installation

## Requirements

- ERPNext v14 or v15
- QZ Tray installed on client machines (https://qz.io/download/)
- Thermal printer with TSPL support

## Installation

```bash
# Get the app
bench get-app https://github.com/zxrrcpandey/trustbit_barcode.git

# Install on your site
bench --site your-site-name install-app trustbit_barcode

# Run migrate (creates DocTypes)
bench --site your-site-name migrate

# Restart bench
bench restart
```

## Configuration

After installation, go to **Barcode Print Settings** to configure:

1. **Default Printer Name**: The exact printer name as shown in your system
2. **Default Price List**: Price list to fetch selling prices from
3. **Label Sizes**: Add your label configurations

A default label size (35x15mm 2-up) is created automatically during installation.

## Usage

1. Open a **submitted** Purchase Invoice, Sales Invoice, or Stock Entry
2. Click **Create → Print Barcode Labels**
3. Select items and quantities
4. Click **Print Barcodes**

## Printer Setup

1. Install QZ Tray from https://qz.io/download/
2. Add your thermal printer in system settings
3. Note the exact printer name
4. Update printer name in Barcode Print Settings

## Troubleshooting

**Button not showing:**
- Clear browser cache (Ctrl+Shift+R)
- Document must be submitted (docstatus = 1)
- Run `bench build --app trustbit_barcode`

**QZ Tray errors:**
- Ensure QZ Tray is running
- Check printer name matches exactly
- Allow QZ Tray permissions in browser

**No label sizes in dropdown:**
- Go to Barcode Print Settings
- Add at least one label size configuration

## License

MIT License - Copyright (c) 2025 Trustbit
