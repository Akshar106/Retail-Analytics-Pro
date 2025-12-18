import os
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from pymongo import MongoClient
from bson.objectid import ObjectId
from bson.errors import InvalidId
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from sklearn.cluster import KMeans
import math
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

MONGO_URI = "mongodb://localhost:27017/"
DB_NAME = "retail_db"
COLLECTION = "transactions"


app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

try:
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    client.server_info()  
    db = client[DB_NAME]
    col = db[COLLECTION]
    logger.info(f"Successfully connected to MongoDB: {DB_NAME}.{COLLECTION}")
except Exception as e:
    logger.error(f"Failed to connect to MongoDB: {e}")
    col = None

# ========== HELPER FUNCTIONS ==========
def doc_to_json(d):
    """Convert MongoDB document to JSON-serializable dict"""
    out = {}
    for k, v in d.items():
        if isinstance(v, ObjectId):
            out[k] = str(v)
        elif isinstance(v, datetime):
            out[k] = v.isoformat()
        elif isinstance(v, (np.integer, np.int64)):
            out[k] = int(v)
        elif isinstance(v, (np.floating, np.float64)):
            out[k] = float(v)
        elif pd.isna(v):
            out[k] = None
        else:
            out[k] = v
    return out

def parse_date_param(s):
    """Parse date parameter from string"""
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace('Z', '+00:00'))
    except Exception:
        try:
            return datetime.strptime(s, "%Y-%m-%d")
        except Exception:
            return None

def load_df(filter_query=None):
    """Load collection into pandas DataFrame"""
    if col is None:
        return pd.DataFrame()
    
    q = filter_query or {}
    try:
        docs = list(col.find(q).limit(100000))  
        if len(docs) == 0:
            return pd.DataFrame()
        
        df = pd.DataFrame(docs)
        
        # Ensure InvoiceDate is datetime
        if "InvoiceDate" in df.columns:
            df["InvoiceDate"] = pd.to_datetime(df["InvoiceDate"], errors="coerce")
        
        # Ensure required columns exist
        for c in ["Invoice", "StockCode", "Description", "Quantity", "Price", "CustomerID", "Country"]:
            if c not in df.columns:
                df[c] = None
        
        # Calculate revenue
        df["Quantity"] = pd.to_numeric(df["Quantity"], errors="coerce").fillna(0)
        df["Price"] = pd.to_numeric(df["Price"], errors="coerce").fillna(0.0)
        df["Revenue"] = df["Quantity"] * df["Price"]
        
        return df
    except Exception as e:
        logger.error(f"Error loading DataFrame: {e}")
        return pd.DataFrame()

def apply_date_filters(df, start, end):
    """Apply date range filters to DataFrame"""
    if df.empty:
        return df
    
    if start:
        df = df[df["InvoiceDate"].notna() & (df["InvoiceDate"] >= start)]
    if end:
        end_of_day = end + timedelta(days=1)
        df = df[df["InvoiceDate"].notna() & (df["InvoiceDate"] < end_of_day)]
    
    return df

# ========== ROUTES ==========
@app.route('/')
def home():
    """Render main dashboard page"""
    return render_template('index.html')

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    db_status = "connected" if col is not None else "disconnected"
    return jsonify({
        "status": "ok",
        "database": db_status,
        "timestamp": datetime.utcnow().isoformat()
    })

# ========== TRANSACTIONS CRUD ==========
@app.route("/api/transactions", methods=["GET"])
def get_transactions():
    """Get transactions with optional filters"""
    try:
        start = parse_date_param(request.args.get("start_date"))
        end = parse_date_param(request.args.get("end_date"))
        countries = request.args.get("countries")
        invoice = request.args.get("invoice")
        limit = int(request.args.get("limit", 1000))
        
        q = {}
        if invoice:
            q["Invoice"] = invoice
        if countries:
            country_list = [c.strip() for c in countries.split(",") if c.strip()]
            if country_list:
                q["Country"] = {"$in": country_list}
        
        df = load_df(q)
        if df.empty:
            return jsonify([])
        
        df = apply_date_filters(df, start, end)
        df = df.head(limit)
        
        rows = [doc_to_json(row.to_dict()) for _, row in df.iterrows()]
        return jsonify(rows)
    except Exception as e:
        logger.error(f"Error in get_transactions: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/transactions", methods=["POST"])
def create_transaction():
    """Create new transaction"""
    try:
        payload = request.json or {}
        
        doc = {
            "Invoice": str(payload.get("Invoice", "")),
            "StockCode": str(payload.get("StockCode", "")),
            "Description": str(payload.get("Description", "")),
            "Quantity": int(payload.get("Quantity", 0)),
            "Price": float(payload.get("Price", 0.0)),
            "CustomerID": payload.get("CustomerID"),
            "Country": str(payload.get("Country", "")),
        }
        
        inv_date = payload.get("InvoiceDate")
        if inv_date:
            doc["InvoiceDate"] = parse_date_param(inv_date) or datetime.utcnow()
        else:
            doc["InvoiceDate"] = datetime.utcnow()
        
        if col is None:
            return jsonify({"error": "Database not connected"}), 500
        
        res = col.insert_one(doc)
        logger.info(f"Created transaction: {res.inserted_id}")
        return jsonify({"inserted_id": str(res.inserted_id)}), 201
    except Exception as e:
        logger.error(f"Error creating transaction: {e}")
        return jsonify({"error": str(e)}), 400

@app.route("/api/transactions/<id>", methods=["PUT"])
def update_transaction(id):
    """Update existing transaction"""
    try:
        oid = ObjectId(id)
    except InvalidId:
        return jsonify({"error": "Invalid ID format"}), 400
    
    try:
        payload = request.json or {}
        update_doc = {}
        
        for k in ["Invoice", "StockCode", "Description", "Quantity", "Price", "CustomerID", "Country", "InvoiceDate"]:
            if k in payload:
                if k == "InvoiceDate" and payload[k]:
                    parsed = parse_date_param(payload[k])
                    update_doc[k] = parsed if parsed else payload[k]
                elif k == "Quantity":
                    update_doc[k] = int(payload[k])
                elif k == "Price":
                    update_doc[k] = float(payload[k])
                else:
                    update_doc[k] = payload[k]
        
        if not update_doc:
            return jsonify({"error": "No fields to update"}), 400
        
        if col is None:
            return jsonify({"error": "Database not connected"}), 500
        
        res = col.update_one({"_id": oid}, {"$set": update_doc})
        logger.info(f"Updated transaction {id}: {res.modified_count} modified")
        return jsonify({"matched": res.matched_count, "modified": res.modified_count})
    except Exception as e:
        logger.error(f"Error updating transaction: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/transactions/<id>", methods=["DELETE"])
def delete_transaction(id):
    """Delete transaction"""
    try:
        oid = ObjectId(id)
    except InvalidId:
        return jsonify({"error": "Invalid ID format"}), 400
    
    try:
        if col is None:
            return jsonify({"error": "Database not connected"}), 500
        
        res = col.delete_one({"_id": oid})
        logger.info(f"Deleted transaction {id}: {res.deleted_count} deleted")
        return jsonify({"deleted": res.deleted_count})
    except Exception as e:
        logger.error(f"Error deleting transaction: {e}")
        return jsonify({"error": str(e)}), 500

# ========== ANALYTICS ENDPOINTS ==========
@app.route("/api/summary", methods=["GET"])
def summary():
    """Get summary KPIs"""
    try:
        start = parse_date_param(request.args.get("start_date"))
        end = parse_date_param(request.args.get("end_date"))
        countries = request.args.get("countries")
        
        q = {}
        if countries:
            country_list = [c.strip() for c in countries.split(",") if c.strip()]
            if country_list:
                q["Country"] = {"$in": country_list}
        
        df = load_df(q)
        if df.empty:
            return jsonify({
                "total_revenue": 0.0,
                "total_orders": 0,
                "unique_customers": 0,
                "avg_order_value": 0.0
            })
        
        df = apply_date_filters(df, start, end)
        
        total_revenue = float(df["Revenue"].sum())
        total_orders = int(df["Invoice"].nunique())
        unique_customers = int(df["CustomerID"].nunique())
        avg_order_value = (total_revenue / total_orders) if total_orders else 0.0
        
        return jsonify({
            "total_revenue": total_revenue,
            "total_orders": total_orders,
            "unique_customers": unique_customers,
            "avg_order_value": avg_order_value
        })
    except Exception as e:
        logger.error(f"Error in summary: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/revenue_by_country", methods=["GET"])
def revenue_by_country():
    """Get revenue aggregated by country"""
    try:
        start = parse_date_param(request.args.get("start_date"))
        end = parse_date_param(request.args.get("end_date"))
        countries = request.args.get("countries")
        
        q = {}
        if countries:
            country_list = [c.strip() for c in countries.split(",") if c.strip()]
            if country_list:
                q["Country"] = {"$in": country_list}
        
        df = load_df(q)
        if df.empty:
            return jsonify([])
        
        df = apply_date_filters(df, start, end)
        
        agg = df.groupby("Country")["Revenue"].sum().reset_index()
        agg = agg.sort_values("Revenue", ascending=False)
        
        result = [doc_to_json(row.to_dict()) for _, row in agg.iterrows()]
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error in revenue_by_country: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/top_products", methods=["GET"])
def top_products():
    """Get top products by revenue"""
    try:
        limit = int(request.args.get("limit", 10))
        start = parse_date_param(request.args.get("start_date"))
        end = parse_date_param(request.args.get("end_date"))
        countries = request.args.get("countries")
        
        q = {}
        if countries:
            country_list = [c.strip() for c in countries.split(",") if c.strip()]
            if country_list:
                q["Country"] = {"$in": country_list}
        
        df = load_df(q)
        if df.empty:
            return jsonify([])
        
        df = apply_date_filters(df, start, end)
        
        # Group by product
        agg = df.groupby(["StockCode", "Description"]).agg({
            "Revenue": "sum",
            "Quantity": "sum"
        }).reset_index()
        
        agg = agg.sort_values("Revenue", ascending=False).head(limit)
        
        result = [doc_to_json(row.to_dict()) for _, row in agg.iterrows()]
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error in top_products: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/monthly_trend", methods=["GET"])
def monthly_trend():
    """Get monthly revenue trend"""
    try:
        start = parse_date_param(request.args.get("start_date"))
        end = parse_date_param(request.args.get("end_date"))
        countries = request.args.get("countries")
        
        q = {}
        if countries:
            country_list = [c.strip() for c in countries.split(",") if c.strip()]
            if country_list:
                q["Country"] = {"$in": country_list}
        
        df = load_df(q)
        if df.empty:
            return jsonify([])
        
        df = apply_date_filters(df, start, end)
        
        # Remove rows with null dates
        df = df[df["InvoiceDate"].notna()].copy()
        
        if df.empty:
            return jsonify([])
        
        df["year_month"] = df["InvoiceDate"].dt.to_period("M").astype(str)
        monthly_rev = df.groupby("year_month")["Revenue"].sum().reset_index()
        monthly_rev = monthly_rev.sort_values("year_month")
        
        result = [doc_to_json(row.to_dict()) for _, row in monthly_rev.iterrows()]
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error in monthly_trend: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/countries", methods=["GET"])
def countries_list():
    """Get list of unique countries"""
    try:
        df = load_df()
        if df.empty:
            return jsonify([])
        
        countries = sorted(df["Country"].dropna().unique().tolist())
        return jsonify(countries)
    except Exception as e:
        logger.error(f"Error in countries_list: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/rfm", methods=["GET"])
def rfm_endpoint():
    """Perform RFM analysis with clustering"""
    try:
        k = int(request.args.get("k", 3))
        k = max(2, min(k, 8))  # Constrain between 2-8
        
        df = load_df()
        if df.empty:
            return jsonify([])
        
        # Filter out null CustomerIDs and ensure we have valid invoice dates
        cust = df[df["CustomerID"].notna() & df["InvoiceDate"].notna()].copy()
        if cust.empty:
            return jsonify([])
        
        now = pd.Timestamp.now()
        
        # Calculate RFM metrics
        summary = cust.groupby("CustomerID").agg(
            Recency=("InvoiceDate", lambda x: (now - x.max()).days if x.notna().any() and len(x) > 0 else np.nan),
            Frequency=("Invoice", lambda x: x.nunique()),
            Monetary=("Revenue", "sum")
        ).reset_index()
        
        # Remove any rows with null or invalid values
        summary = summary.dropna(subset=["Recency", "Frequency", "Monetary"])
        
        # Remove rows with negative or zero values
        summary = summary[
            (summary["Recency"] >= 0) & 
            (summary["Frequency"] > 0) & 
            (summary["Monetary"] > 0)
        ]
        
        # Remove infinite values
        summary = summary.replace([np.inf, -np.inf], np.nan)
        summary = summary.dropna()
        
        if summary.empty or len(summary) < k:
            # Not enough data for clustering
            logger.warning(f"Not enough data for clustering: {len(summary)} customers, need at least {k}")
            if len(summary) > 0:
                result = summary.assign(cluster=0)
                return jsonify([doc_to_json(row.to_dict()) for _, row in result.iterrows()])
            return jsonify([])
        
        # Prepare features for clustering
        feat = summary[["Recency", "Frequency", "Monetary"]].copy()
        
        # Apply log transformation to Monetary (helps with skewed distribution)
        feat["Monetary"] = np.log1p(feat["Monetary"].astype(float))
        
        # Double-check for NaN after transformation
        feat = feat.replace([np.inf, -np.inf], np.nan)
        feat = feat.fillna(0)  # Fill any remaining NaN with 0
        
        # Verify no NaN values remain
        if feat.isna().any().any():
            logger.error("NaN values still present after cleaning")
            # Remove rows with NaN
            valid_indices = ~feat.isna().any(axis=1)
            feat = feat[valid_indices]
            summary = summary[valid_indices]
        
        if len(feat) < k:
            logger.warning(f"After cleaning: {len(feat)} customers, need at least {k}")
            result = summary.assign(cluster=0)
            return jsonify([doc_to_json(row.to_dict()) for _, row in result.iterrows()])
        
        # Normalize features using StandardScaler
        from sklearn.preprocessing import StandardScaler
        scaler = StandardScaler()
        
        # Fit and transform, ensuring no NaN values
        try:
            feat_scaled = scaler.fit_transform(feat)
            
            # Final NaN check after scaling
            if np.isnan(feat_scaled).any():
                logger.error("NaN values present after scaling")
                feat_scaled = np.nan_to_num(feat_scaled, nan=0.0, posinf=0.0, neginf=0.0)
            
        except Exception as scale_error:
            logger.error(f"Scaling error: {scale_error}")
            return jsonify({"error": "Error during feature scaling"}), 500
        
        # Perform clustering
        try:
            kmeans = KMeans(n_clusters=k, random_state=42, n_init=10, max_iter=300)
            clusters = kmeans.fit_predict(feat_scaled)
            summary["cluster"] = clusters
        except Exception as cluster_error:
            logger.error(f"Clustering error: {cluster_error}")
            return jsonify({"error": "Error during clustering"}), 500
        
        # Convert to JSON-serializable format
        result = []
        for _, row in summary.iterrows():
            # Ensure all values are valid before adding
            recency_val = row["Recency"]
            frequency_val = row["Frequency"]
            monetary_val = row["Monetary"]
            
            # Skip if any value is invalid
            if pd.isna(recency_val) or pd.isna(frequency_val) or pd.isna(monetary_val):
                continue
                
            result.append({
                "CustomerID": str(row["CustomerID"]),
                "Recency": int(recency_val),
                "Frequency": int(frequency_val),
                "Monetary": float(monetary_val),
                "cluster": int(row["cluster"])
            })
        
        logger.info(f"RFM analysis completed: {len(result)} customers, {k} clusters")
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"Error in rfm_endpoint: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return jsonify({"error": str(e)}), 500

# ========== ERROR HANDLERS ==========
@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Endpoint not found"}), 404

@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": "Internal server error"}), 500

# ========== MAIN ==========
if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    debug = os.getenv("FLASK_ENV") == "development"
    app.run(host="0.0.0.0", port=port, debug=debug)