# Trustbit Barcode

Direct thermal barcode label printing from ERPNext with QZ Tray integration.

## Features

- Print barcode labels directly from Purchase Receipt, Purchase Invoice, Sales Invoice, and Stock Entry
- Shelf prices: sell old and new stock of one item at their own printed prices (see below)
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

### Standard Installation

```bash
bench get-app https://github.com/zxrrcpandey/trustbit_barcode.git
bench --site your-site-name install-app trustbit_barcode
bench --site your-site-name migrate
bench restart
```

### If Build Fails (Alternative Installation)

If you encounter esbuild errors during installation, use this method:

```bash
# Step 1: Get app without building assets
bench get-app https://github.com/zxrrcpandey/trustbit_barcode.git --skip-assets

# Step 2: Manually link assets
mkdir -p ~/frappe-bench/sites/assets/trustbit_barcode/js/
cp ~/frappe-bench/apps/trustbit_barcode/trustbit_barcode/public/js/* ~/frappe-bench/sites/assets/trustbit_barcode/js/

# Step 3: Add to apps.txt (IMPORTANT: use printf to avoid concatenation issues)
printf '\ntrustbit_barcode\n' >> ~/frappe-bench/sites/apps.txt

# Step 4: Remove any duplicate/corrupted entries
# Check the file first:
cat ~/frappe-bench/sites/apps.txt
# If you see corrupted entries like "hrmstrustbit_barcode", fix manually:
# nano ~/frappe-bench/sites/apps.txt

# Step 5: Install and migrate
bench --site your-site-name install-app trustbit_barcode
bench --site your-site-name migrate
bench restart
```

## Configuration

After installation, go to **Barcode Print Settings** to configure:

1. **Default Printer Name**: The exact printer name as shown in your system
2. **Default Price List**: Price list to fetch selling prices from
3. **Label Sizes**: Add your label configurations

A default label size (35x15mm 2-up) is created automatically during installation.

## Usage

1. Open a **submitted** Purchase Receipt, Purchase Invoice, Sales Invoice, or Stock Entry
2. Click **Create → Print Barcode Labels**
3. Select items and quantities
4. Click **Print Barcodes**

## Shelf Prices (v1.1.0)

One item, on the shelf at more than one printed price — old stock at the old MRP,
new stock at the new one — instead of a second Item for the same product.

**Receiving.** On a Purchase Receipt or Purchase Invoice line, fill
**Selling Price on Pack (MRP)** (per stock unit) only when the price printed on the
goods differs from today's selling price. Saving the draft shows what will change;
submitting applies it:

| New printed price | What happens |
|---|---|
| Higher | Selling price becomes the new one; the old price stays **on the shelf** for the copies already there (a copy is never sold above the price printed on it) |
| Lower | The lower price applies to every copy; shelf prices above it are switched off |
| Same | Nothing |
| Item had no price | It gets this one |

Returns to the supplier never change prices. A problem on one line is rolled back,
logged (Error Log) and shown in red — the receipt itself always submits.

**New barcode (optional).** Tick **New Barcode for This Price** to give the price
its own shop barcode — the next free `1xxxxx` number, added to the Item. The line's
**Price Barcode** shows it, and **Print Barcode Labels** prints that barcode and price.

**Selling.** In POS Awesome (fork ≥ 2.7.0) and on desk Sales Invoices:
- scanning a price's own barcode sells at that price;
- any other way of adding an item with two or more active prices asks
  *Which price is printed on this copy?* (keys 1–9, click, Esc = do not add);
- the usual discounts apply on top of the chosen price; it is saved on the line as
  **Shelf Price (printed on the copy)**.

**Housekeeping.** The **Shelf Price** list shows every price by item. Untick
**On the Shelf** when the copies at a price are gone — prices are never switched off
by stock figures. The Item form shows the active prices at the top. **Make Barcode**
on a Shelf Price gives an existing price its own barcode.

## Printer Setup

1. Install QZ Tray from https://qz.io/download/
2. Add your thermal printer in system settings
3. Note the exact printer name (e.g., "Bar Code Printer TT065-50")
4. Update printer name in Barcode Print Settings

## Troubleshooting

### Button not showing
- Clear browser cache (Ctrl+Shift+R)
- Document must be submitted (docstatus = 1)
- Check browser console (F12) for errors

### QZ Tray errors
- Ensure QZ Tray is running (check system tray)
- Check printer name matches exactly
- Allow QZ Tray permissions in browser

### No label sizes in dropdown
- Go to Barcode Print Settings
- Add at least one label size configuration

### Build errors during installation
- Use the alternative installation method above
- The app uses simple JS files that don't require bundling

### "App not in apps.txt" error
- Check apps.txt for corrupted entries: `cat ~/frappe-bench/sites/apps.txt`
- Fix any entries that are concatenated (e.g., "hrmstrustbit_barcode" should be "hrms" and "trustbit_barcode" on separate lines)
- Always use `printf '\napp_name\n'` instead of `echo "app_name"` when adding to apps.txt

## Uninstallation

```bash
bench --site your-site-name uninstall-app trustbit_barcode --yes
bench remove-app trustbit_barcode
```

## License

MIT License - Copyright (c) 2025 Trustbit
