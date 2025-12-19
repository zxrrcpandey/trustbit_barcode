# -*- coding: utf-8 -*-
# Copyright (c) 2025, Trustbit and contributors
# For license information, please see license.txt

"""
Trustbit Barcode - Installation Script
Creates default settings after app installation
"""

from __future__ import unicode_literals
import frappe


def after_install():
    """Set up default Barcode Print Settings after installation."""
    create_default_settings()
    frappe.db.commit()


def create_default_settings():
    """Create Barcode Print Settings with default label size."""
    
    # Check if settings already exist and have label sizes
    try:
        settings = frappe.get_single("Barcode Print Settings")
        if settings.label_sizes and len(settings.label_sizes) > 0:
            # Settings already configured, don't overwrite
            return
    except Exception:
        pass
    
    # Create or update settings
    settings = frappe.get_single("Barcode Print Settings")
    settings.default_printer = settings.default_printer or "Bar Code Printer TT065-50"
    settings.default_price_list = settings.default_price_list or "Standard Selling"
    
    # Add default label size if none exists
    if not settings.label_sizes or len(settings.label_sizes) == 0:
        settings.append("label_sizes", {
            "label_name": "35x15mm 2-up",
            "is_default": 1,
            "printer_name": "Bar Code Printer TT065-50",
            "label_width": 70,
            "label_height": 15,
            "gap_height": 3,
            "labels_per_row": 2,
            "printable_height": 10,
            "left_label_x": 8,
            "right_label_x": 305,
            "print_speed": 4,
            "print_density": 8
        })
    
    settings.save()
    frappe.msgprint("Barcode Print Settings configured with default label size.")
