# -*- coding: utf-8 -*-
# Copyright (c) 2025, Trustbit and contributors
# For license information, please see license.txt

"""Install hooks. (Until v1.1.0 this file was a copy of api.py without
`after_install`, so a fresh `bench install-app` failed at the end.)"""


def after_install():
	"""Nothing to set up: Barcode Print Settings falls back to built-in
	defaults until someone saves it (see api.get_barcode_print_settings)."""
	pass
