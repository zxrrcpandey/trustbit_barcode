# -*- coding: utf-8 -*-
# Copyright (c) 2025, Trustbit and contributors
# For license information, please see license.txt

"""
Trustbit Barcode - API v1.0.6
Fetches barcodes, selling prices, and settings from database
New: Added support for configurable gaps and positions
"""

from __future__ import unicode_literals
import frappe
import json
from frappe.utils import flt


@frappe.whitelist()
def get_item_barcodes(item_codes):
    """Fetch barcodes from Item Barcode table."""
    if isinstance(item_codes, str):
        try:
            item_codes = json.loads(item_codes)
        except json.JSONDecodeError:
            item_codes = [item_codes]
    
    if not item_codes:
        return {}
    
    barcodes = frappe.db.sql("""
        SELECT parent, barcode
        FROM `tabItem Barcode`
        WHERE parent IN %s
        ORDER BY idx ASC
    """, [item_codes], as_dict=True)
    
    barcode_map = {}
    for b in barcodes:
        if b.parent not in barcode_map:
            barcode_map[b.parent] = b.barcode
    
    return barcode_map


@frappe.whitelist()
def get_item_details(item_codes, price_list=None):
    """Fetch barcodes AND selling prices for items."""
    if isinstance(item_codes, str):
        try:
            item_codes = json.loads(item_codes)
        except json.JSONDecodeError:
            item_codes = [item_codes]
    
    if not item_codes:
        return {}
    
    # Get default price list from settings
    if not price_list:
        try:
            settings = frappe.get_single("Barcode Print Settings")
            price_list = settings.default_price_list or "Standard Selling"
        except Exception:
            price_list = "Standard Selling"
    
    # Get selling prices from Item Price table
    prices = frappe.db.sql("""
        SELECT item_code, price_list_rate
        FROM `tabItem Price`
        WHERE item_code IN %s
        AND price_list = %s
        AND selling = 1
        ORDER BY valid_from DESC
    """, [item_codes, price_list], as_dict=True)
    
    price_map = {}
    for p in prices:
        if p.item_code not in price_map:
            price_map[p.item_code] = p.price_list_rate or 0
    
    # Fallback to standard_rate
    items_without_price = [ic for ic in item_codes if ic not in price_map]
    if items_without_price:
        fallback = frappe.db.sql("""
            SELECT name, standard_rate
            FROM `tabItem`
            WHERE name IN %s
        """, [items_without_price], as_dict=True)
        
        for item in fallback:
            if item.name not in price_map:
                price_map[item.name] = item.standard_rate or 0
    
    # Get barcodes
    barcodes = frappe.db.sql("""
        SELECT parent, barcode
        FROM `tabItem Barcode`
        WHERE parent IN %s
        ORDER BY idx ASC
    """, [item_codes], as_dict=True)
    
    all_barcodes = {}
    for b in barcodes:
        all_barcodes.setdefault(b.parent, []).append(b.barcode)
    bound = _active_price_barcodes(item_codes, price_list)

    result = {}
    for item_code in item_codes:
        rate = price_map.get(item_code, 0)
        result[item_code] = {
            "barcode": _label_barcode(item_code, rate, all_barcodes.get(item_code, []), bound),
            "selling_rate": rate
        }

    return result


def _active_price_barcodes(item_codes, price_list):
    """{item_code: {barcode: price}} for barcodes bound to an active shelf price."""
    bound = {}
    if not item_codes or not frappe.db.table_exists("Shelf Price"):
        return bound
    for s in frappe.db.sql("""
        SELECT item_code, price, barcode
        FROM `tabShelf Price`
        WHERE item_code IN %s AND price_list = %s AND active = 1 AND IFNULL(barcode, '') != ''
    """, [list(item_codes), price_list], as_dict=True):
        bound.setdefault(s.item_code, {})[s.barcode] = flt(s.price)
    return bound


def _label_barcode(item_code, price, barcodes, bound):
    """The barcode for a label at `price` (shelf prices, v1.1.1): the one bound to
    that price; else the first barcode not bound to ANOTHER active price (the POS
    then asks for the price); else the item code. A label must never carry a
    barcode that sells at a different price."""
    item_bound = bound.get(item_code, {})
    for code, p in item_bound.items():
        if abs(p - flt(price)) < 0.005:
            return code
    for code in barcodes:
        if code not in item_bound:
            return code
    return item_code


@frappe.whitelist()
def get_label_data(rows, price_list=None):
    """Barcode and price for each label row [{item_code, price}] — price is the
    line's printed MRP, or empty for the current selling price."""
    if isinstance(rows, str):
        rows = json.loads(rows)
    rows = rows or []
    item_codes = list({r.get("item_code") for r in rows if r.get("item_code")})
    if not item_codes:
        return []
    details = get_item_details(json.dumps(item_codes), price_list)
    if not price_list:
        price_list = frappe.db.get_single_value("Barcode Print Settings", "default_price_list") or "Standard Selling"
    barcodes = frappe.db.sql("""
        SELECT parent, barcode FROM `tabItem Barcode` WHERE parent IN %s ORDER BY idx ASC
    """, [item_codes], as_dict=True)
    all_barcodes = {}
    for b in barcodes:
        all_barcodes.setdefault(b.parent, []).append(b.barcode)
    bound = _active_price_barcodes(item_codes, price_list)
    out = []
    for r in rows:
        code = r.get("item_code")
        price = flt(r.get("price")) or flt((details.get(code) or {}).get("selling_rate"))
        out.append({
            "barcode": _label_barcode(code, price, all_barcodes.get(code, []), bound) if code else "",
            "selling_rate": price,
        })
    return out


@frappe.whitelist()
def get_barcode_print_settings():
    """Get all barcode print settings including new gap and position fields."""
    try:
        settings = frappe.get_single("Barcode Print Settings")
        
        label_sizes = []
        default_size = None
        
        for size in settings.label_sizes:
            size_data = {
                "name": size.label_name,
                "printer_name": size.printer_name or settings.default_printer,
                "width": size.label_width,
                "height": size.label_height,
                "gap": size.gap_height,
                "labels_per_row": size.labels_per_row,
                "printable_height": size.printable_height,
                
                # Horizontal gaps (new in v1.0.6)
                "left_margin": size.left_margin or 8,
                "middle_gap": size.middle_gap or 16,
                "right_margin": size.right_margin or 8,
                "left_label_x": size.left_label_x or 8,
                "right_label_x": size.right_label_x or 305,
                
                # Barcode settings (new in v1.0.6)
                "barcode_width": size.barcode_width or 2,
                "barcode_height": size.barcode_height or 60,
                
                # Y positions (new in v1.0.6)
                "name_y": size.name_y_position or 2,
                "barcode_y": size.barcode_y_position or 16,
                "barcode_text_y": size.barcode_text_y_position or 80,
                "price_y": size.price_y_position or 96,
                
                # Text settings (new in v1.0.6)
                "text_max_chars": size.text_max_chars or 14,
                
                # Print settings
                "speed": size.print_speed,
                "density": size.print_density,
                "is_default": size.is_default
            }
            label_sizes.append(size_data)
            
            if size.is_default:
                default_size = size.label_name
        
        return {
            "default_printer": settings.default_printer or "Bar Code Printer TT065-50",
            "default_price_list": settings.default_price_list or "Standard Selling",
            "default_label_size": default_size or (label_sizes[0]["name"] if label_sizes else "35x15mm 2-up"),
            "label_sizes": label_sizes
        }
    except Exception:
        # Return defaults if settings not configured
        return {
            "default_printer": "Bar Code Printer TT065-50",
            "default_price_list": "Standard Selling",
            "default_label_size": "35x15mm 2-up",
            "label_sizes": [
                {
                    "name": "35x15mm 2-up",
                    "printer_name": "Bar Code Printer TT065-50",
                    "width": 70, "height": 15, "gap": 3,
                    "labels_per_row": 2, "printable_height": 10,
                    "left_margin": 8, "middle_gap": 16, "right_margin": 8,
                    "left_label_x": 8, "right_label_x": 305,
                    "barcode_width": 2, "barcode_height": 60,
                    "name_y": 2, "barcode_y": 16, "barcode_text_y": 80, "price_y": 96,
                    "text_max_chars": 14,
                    "speed": 4, "density": 8, "is_default": True
                }
            ]
        }


@frappe.whitelist()
def get_price_lists():
    """Get all selling price lists."""
    price_lists = frappe.db.sql("""
        SELECT name
        FROM `tabPrice List`
        WHERE selling = 1
        AND enabled = 1
        ORDER BY name ASC
    """, as_dict=True)
    
    return [p.name for p in price_lists]