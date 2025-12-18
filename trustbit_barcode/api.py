# -*- coding: utf-8 -*-
# Copyright (c) 2025, Trustbit and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe
import json


@frappe.whitelist()
def get_item_barcodes(item_codes):
    """
    Fetch actual barcodes from Item Barcode table for given item codes.
    """
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
def get_item_details(item_codes):
    """
    Fetch barcodes AND standard selling rates for items.
    """
    if isinstance(item_codes, str):
        try:
            item_codes = json.loads(item_codes)
        except json.JSONDecodeError:
            item_codes = [item_codes]
    
    if not item_codes:
        return {}
    
    # Get standard selling rates from Item master
    items = frappe.db.sql("""
        SELECT name, standard_rate
        FROM `tabItem`
        WHERE name IN %s
    """, [item_codes], as_dict=True)
    
    rate_map = {item.name: item.standard_rate or 0 for item in items}
    
    # Get barcodes
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
    
    # Combine into single response
    result = {}
    for item_code in item_codes:
        result[item_code] = {
            "barcode": barcode_map.get(item_code, item_code),
            "standard_rate": rate_map.get(item_code, 0)
        }
    
    return result


@frappe.whitelist()
def get_purchase_invoice_items(purchase_invoice):
    """
    Get items from a Purchase Invoice with their barcodes and selling rates.
    """
    if not purchase_invoice:
        return []
    
    items = frappe.db.sql("""
        SELECT 
            pii.item_code,
            pii.item_name,
            pii.qty,
            pii.rate,
            pii.amount
        FROM `tabPurchase Invoice Item` pii
        WHERE pii.parent = %s
        ORDER BY pii.idx ASC
    """, purchase_invoice, as_dict=True)
    
    if not items:
        return []
    
    item_codes = [item.item_code for item in items]
    item_details = get_item_details(item_codes)
    
    for item in items:
        details = item_details.get(item.item_code, {})
        item['barcode'] = details.get('barcode', item.item_code)
        item['selling_rate'] = details.get('standard_rate', 0)
    
    return items


@frappe.whitelist()
def get_printer_settings():
    """
    Get printer settings for barcode printing.
    """
    return {
        "printer_name": "Bar Code Printer TT065-50",
        "label_sizes": [
            {"value": "35x15", "label": "35×15mm (2-up on 70mm roll)"},
            {"value": "35x21", "label": "35×21mm (2-up on 70mm roll)"},
            {"value": "38x25", "label": "38×25mm"}
        ],
        "default_size": "35x15",
        "dpi": 203
    }