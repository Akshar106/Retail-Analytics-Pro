# import_csv_to_mongo.py
import pandas as pd
from pymongo import MongoClient, InsertOne
from datetime import datetime
import math

CSV_PATH = "data.csv"           
MONGO_URI = "mongodb+srv://onlineretail:Akshar%401107@onlineretail.dypymnu.mongodb.net/" 
DB_NAME = "Online_Retail"
COLLECTION = "transactions"
BATCH_SIZE = 1000

df = pd.read_csv(CSV_PATH, dtype=str) 

print("Rows read:", len(df))
print("Columns:", df.columns.tolist())

# Normalize header names
# If header is "Customer ID" convert to "CustomerID", strip whitespace
df.columns = [c.strip().replace(" ", "") for c in df.columns]

def parse_invoice_date(s):
    if pd.isna(s):
        return None
    s = str(s).strip()
    try:
        # sample format: "01-12-2009 07:45" -> %d-%m-%Y %H:%M
        return datetime.strptime(s, "%d-%m-%Y %H:%M")
    except Exception:
        # fallback to dateutil.parser
        from dateutil.parser import parse
        try:
            return parse(s)
        except Exception:
            return None

def to_int(s):
    try:
        if s is None or s == "" or str(s).strip().lower() in ("nan","none"):
            return None
        return int(float(str(s).strip()))
    except Exception:
        return None

def to_float(s):
    try:
        if s is None or s == "" or str(s).strip().lower() in ("nan","none"):
            return None
        f = float(str(s).strip())
        if math.isfinite(f):
            return f
        return None
    except Exception:
        return None

records = []
for i, row in df.iterrows():
    invoice = str(row.get("Invoice","")).strip() or None
    stockcode = str(row.get("StockCode","")).strip() or None
    description = str(row.get("Description","")).strip() or None
    quantity = to_int(row.get("Quantity", None))
    invoice_date = parse_invoice_date(row.get("InvoiceDate", None))
    price = to_float(row.get("Price", None))
    customer_id = to_int(row.get("CustomerID", row.get("Customer ID", None)))
    country = str(row.get("Country","")).strip() or None

    doc = {
        "Invoice": invoice,
        "StockCode": stockcode,
        "Description": description,
        "Quantity": quantity,
        "InvoiceDate": invoice_date,
        "Price": price,
        "CustomerID": customer_id,
        "Country": country
    }
    records.append(doc)

client = MongoClient(MONGO_URI)
db = client[DB_NAME]
col = db[COLLECTION]
col.create_index("Invoice")
col.create_index("CustomerID")
col.create_index("InvoiceDate")

# Insert in batches for large files
ops = []
count = 0
for r in records:
    ops.append(InsertOne(r))
    if len(ops) >= BATCH_SIZE:
        col.bulk_write(ops)
        count += len(ops)
        print(f"Inserted {count} documents...")
        ops = []
if ops:
    col.bulk_write(ops)
    count += len(ops)
    print(f"Inserted {count} documents (final).")

print("Done. Total inserted:", count)
