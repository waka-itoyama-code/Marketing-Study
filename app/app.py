import csv
import io
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024  # 10 MB

REQUIRED_COLS = ["広告種別", "広告媒体", "Imp数", "クリック数", "CV数", "課金", "広告費"]


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/analyze", methods=["POST"])
def analyze():
    if "file" not in request.files:
        return jsonify({"error": "ファイルが見つかりません"}), 400

    file = request.files["file"]
    if not file.filename.lower().endswith(".csv"):
        return jsonify({"error": "CSVファイル(.csv)を選択してください"}), 400

    # encoding fallback: UTF-8 → Shift-JIS
    content = None
    for enc in ("utf-8-sig", "shift_jis", "cp932"):
        try:
            content = file.read().decode(enc)
            file.seek(0)
            break
        except (UnicodeDecodeError, Exception):
            file.seek(0)

    if content is None:
        return jsonify({"error": "ファイルのエンコードを読み取れません。UTF-8で保存してください"}), 400

    try:
        rows = _parse_csv(content)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    metrics = _compute_metrics(rows)
    summary = _compute_summary(metrics)
    return jsonify({"metrics": metrics, "summary": summary, "rowCount": len(rows)})


# ── CSV parsing ──────────────────────────────────────────────────────────────

def _parse_csv(content: str) -> list[dict]:
    reader = csv.DictReader(io.StringIO(content))
    headers = list(reader.fieldnames or [])

    missing = [c for c in REQUIRED_COLS if c not in headers]
    if missing:
        raise ValueError(f"必須の列が見つかりません: {', '.join(missing)}")

    rows = []
    for i, row in enumerate(reader, start=2):
        try:
            rows.append({
                "広告種別":  row.get("広告種別", "").strip(),
                "広告媒体":  row.get("広告媒体", "").strip(),
                "Imp数":     _to_float(row.get("Imp数", 0)),
                "クリック数": _to_float(row.get("クリック数", 0)),
                "CV数":      _to_float(row.get("CV数", 0)),
                "課金":      row.get("課金", "").strip(),  # 課金方式は文字列（CPC課金・枠売り 等）
                "広告費":    _to_float(row.get("広告費", 0)),
            })
        except ValueError:
            raise ValueError(f"{i} 行目の数値データが正しくありません")

    if not rows:
        raise ValueError("データ行がありません")
    return rows


def _to_float(v) -> float:
    if isinstance(v, (int, float)):
        return float(v)
    return float(str(v).replace(",", "").strip() or 0)


# ── Metrics computation ──────────────────────────────────────────────────────

def _compute_metrics(rows: list[dict]) -> list[dict]:
    result = []
    for row in rows:
        imp    = row["Imp数"]
        clicks = row["クリック数"]
        cv     = row["CV数"]
        cost   = row["広告費"]

        result.append({
            "adType":  row["広告種別"],
            "adMedia": row["広告媒体"],
            "imp":     int(imp),
            "clicks":  int(clicks),
            "cv":      int(cv),
            "charge":  row["課金"],
            "cost":    int(cost),
            "CPC": round(cost / clicks)         if clicks > 0 else None,
            "CPM": round(cost / imp * 1000, 1)  if imp    > 0 else None,
            "CPA": round(cost / cv)             if cv     > 0 else None,
            "CTR": round(clicks / imp * 100, 2) if imp    > 0 else None,
            "CVR": round(cv / clicks * 100, 2)  if clicks > 0 else None,
        })
    return result


def _compute_summary(metrics: list[dict]) -> dict:
    total_cost   = sum(m["cost"]   for m in metrics)
    total_imp    = sum(m["imp"]    for m in metrics)
    total_clicks = sum(m["clicks"] for m in metrics)
    total_cv     = sum(m["cv"]     for m in metrics)

    return {
        "totalCost":   total_cost,
        "totalImp":    total_imp,
        "totalClicks": total_clicks,
        "totalCV":     total_cv,
        "avgCPC": round(total_cost / total_clicks)            if total_clicks > 0 else None,
        "avgCPM": round(total_cost / total_imp * 1000, 1)    if total_imp    > 0 else None,
        "avgCPA": round(total_cost / total_cv)               if total_cv     > 0 else None,
        "avgCTR": round(total_clicks / total_imp * 100, 2)   if total_imp    > 0 else None,
        "avgCVR": round(total_cv / total_clicks * 100, 2)    if total_clicks > 0 else None,
    }


if __name__ == "__main__":
    app.run(debug=True, port=5000)
