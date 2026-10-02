from setuptools import setup, find_packages

with open("requirements.txt") as f:
    install_requires = f.read().strip().split("\n")

# Remove empty lines and comments
install_requires = [x for x in install_requires if x and not x.startswith("#")]

setup(
    name="trustbit_barcode",
    version="1.1.0",
    description="Direct thermal barcode label printing from ERPNext with QZ Tray",
    author="Trustbit",
    author_email="ra.pandey008@gmail.com",
    packages=find_packages(),
    zip_safe=False,
    include_package_data=True,
    install_requires=install_requires,
)
