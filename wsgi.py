import csv
import io
import re
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


# ── Casestudy ────────────────────────────────────────────────────────────────

CASESTUDY_REQUIRED = ["月", "広告種別", "広告媒体", "Imp数", "クリック数", "CV数", "課金", "広告費"]


@app.route("/casestudy")
def casestudy():
    return render_template("casestudy.html")


@app.route("/api/casestudy", methods=["POST"])
def casestudy_api():
    if "file" not in request.files:
        return jsonify({"error": "ファイルが見つかりません"}), 400
    file = request.files["file"]
    if not file.filename.lower().endswith(".csv"):
        return jsonify({"error": "CSVファイル(.csv)を選択してください"}), 400

    content = None
    for enc in ("utf-8-sig", "shift_jis", "cp932"):
        try:
            content = file.read().decode(enc)
            file.seek(0)
            break
        except Exception:
            file.seek(0)
    if content is None:
        return jsonify({"error": "ファイルのエンコードを読み取れません"}), 400

    try:
        rows = _parse_casestudy_csv(content)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    return jsonify(_build_casestudy_result(rows))


def _parse_casestudy_csv(content: str) -> list[dict]:
    reader = csv.DictReader(io.StringIO(content))
    headers = list(reader.fieldnames or [])
    missing = [c for c in CASESTUDY_REQUIRED if c not in headers]
    if missing:
        raise ValueError(f"必須の列が見つかりません: {', '.join(missing)}")

    rows = []
    for i, row in enumerate(reader, start=2):
        try:
            rows.append({
                "月":       row.get("月", "").strip(),
                "広告種別": row.get("広告種別", "").strip(),
                "広告媒体": row.get("広告媒体", "").strip(),
                "Imp数":    _to_float(row.get("Imp数", 0)),
                "クリック数": _to_float(row.get("クリック数", 0)),
                "CV数":     _to_float(row.get("CV数", 0)),
                "課金":     row.get("課金", "").strip(),
                "広告費":   _to_float(row.get("広告費", 0)),
            })
        except ValueError:
            raise ValueError(f"{i} 行目の数値データが正しくありません")
    if not rows:
        raise ValueError("データ行がありません")
    return rows


def _period_sort_key(p: str) -> int:
    m = re.search(r"(\d+)", str(p))
    return int(m.group(1)) if m else 0


def _build_casestudy_result(rows: list[dict]) -> dict:
    periods = sorted(set(r["月"] for r in rows), key=_period_sort_key)
    ads     = sorted(set(f"{r['広告種別']} / {r['広告媒体']}" for r in rows))

    # Aggregate by (月, ad)
    agg: dict[tuple, dict] = {}
    for r in rows:
        key = (r["月"], f"{r['広告種別']} / {r['広告媒体']}")
        if key not in agg:
            agg[key] = {"imp": 0.0, "clicks": 0.0, "cv": 0.0, "cost": 0.0}
        agg[key]["imp"]    += r["Imp数"]
        agg[key]["clicks"] += r["クリック数"]
        agg[key]["cv"]     += r["CV数"]
        agg[key]["cost"]   += r["広告費"]

    def _val(a: dict, metric: str):
        imp, cl, cv, cost = a["imp"], a["clicks"], a["cv"], a["cost"]
        if metric == "imp":    return int(imp)
        if metric == "cost":   return int(cost)
        if metric == "clicks": return int(cl)
        if metric == "cv":     return int(cv)
        if metric == "CPC":    return round(cost / cl)           if cl   > 0 else None
        if metric == "CPM":    return round(cost / imp * 1000, 1) if imp  > 0 else None
        if metric == "CPA":    return round(cost / cv)           if cv   > 0 else None
        if metric == "CTR":    return round(cl / imp * 100, 2)   if imp  > 0 else None
        if metric == "CVR":    return round(cv / cl * 100, 2)    if cl   > 0 else None
        return None

    EMPTY = {"imp": 0.0, "clicks": 0.0, "cv": 0.0, "cost": 0.0}
    metrics_list = ["cost", "imp", "CPC", "CPM", "CTR", "CVR", "CPA"]
    series = {
        m: {ad: [_val(agg.get((p, ad), EMPTY), m) for p in periods] for ad in ads}
        for m in metrics_list
    }

    total_cost   = sum(r["広告費"]    for r in rows)
    total_imp    = sum(r["Imp数"]     for r in rows)
    total_clicks = sum(r["クリック数"] for r in rows)
    total_cv     = sum(r["CV数"]      for r in rows)

    summary = {
        "totalCost":   int(total_cost),
        "totalImp":    int(total_imp),
        "totalClicks": int(total_clicks),
        "totalCV":     int(total_cv),
        "avgCPC": round(total_cost / total_clicks)           if total_clicks > 0 else None,
        "avgCPM": round(total_cost / total_imp * 1000, 1)   if total_imp    > 0 else None,
        "avgCPA": round(total_cost / total_cv)              if total_cv     > 0 else None,
        "avgCTR": round(total_clicks / total_imp * 100, 2)  if total_imp    > 0 else None,
        "avgCVR": round(total_cv / total_clicks * 100, 2)   if total_clicks > 0 else None,
    }

    return {"periods": periods, "ads": ads, "series": series,
            "summary": summary, "rowCount": len(rows)}


# ── Compare (year-over-year) ──────────────────────────────────────────────────

COMPARE_REQUIRED = ["チャネル", "訪問者数", "訪問者数シェア", "CV数", "CVシェア", "CVR", "広告費", "CPA"]


def _decode_file(f) -> str:
    for enc in ("utf-8-sig", "shift_jis", "cp932"):
        try:
            content = f.read().decode(enc)
            f.seek(0)
            return content
        except Exception:
            f.seek(0)
    raise ValueError("エンコードを読み取れません。UTF-8で保存してください")


def _to_num(v) -> float:
    s = str(v).strip().replace("%", "").replace(",", "").replace("¥", "").replace("￥", "")
    try:
        return float(s) if s else 0.0
    except ValueError:
        return 0.0


def _parse_compare_csv(content: str) -> list[dict]:
    reader  = csv.DictReader(io.StringIO(content))
    headers = list(reader.fieldnames or [])
    missing = [c for c in COMPARE_REQUIRED if c not in headers]
    if missing:
        raise ValueError(f"必須の列が見つかりません: {', '.join(missing)}")

    rows = []
    for row in reader:
        ch = row.get("チャネル", "").strip()
        if not ch:
            continue
        rows.append({
            "チャネル":      ch,
            "訪問者数":      _to_num(row.get("訪問者数",      0)),
            "訪問者数シェア": _to_num(row.get("訪問者数シェア", 0)),
            "CV数":         _to_num(row.get("CV数",          0)),
            "CVシェア":     _to_num(row.get("CVシェア",       0)),
            "CVR":          _to_num(row.get("CVR",           0)),
            "広告費":        _to_num(row.get("広告費",         0)),
            "CPA":          _to_num(row.get("CPA",           0)),
        })
    if not rows:
        raise ValueError("データ行がありません")
    return rows


def _channel_metrics(rows: list[dict]) -> dict:
    result = {}
    for r in rows:
        ch, v, cost, cv = r["チャネル"], r["訪問者数"], r["広告費"], r["CV数"]
        cpa = r["CPA"] if r["CPA"] > 0 else (round(cost / cv) if cv > 0 else None)
        result[ch] = {
            "訪問者数":       int(v),
            "訪問者数シェア":  round(r["訪問者数シェア"], 2),
            "CV数":           int(cv),
            "CVシェア":       round(r["CVシェア"], 2),
            "CVR":            round(r["CVR"], 2),
            "広告費":          int(cost),
            "CPA":            cpa,
            "CPC":            round(cost / v, 1)          if v  > 0 else None,
            "インプレッション": None,   # not in this CSV
            "CPM":            None,
            "CTR":            None,
        }
    return result


def _compare_totals(rows: list[dict]) -> dict:
    c = sum(r["広告費"]  for r in rows)
    v = sum(r["訪問者数"] for r in rows)
    cv = sum(r["CV数"]   for r in rows)
    return {
        "totalCost":     int(c),
        "totalVisitors": int(v),
        "totalCV":       int(cv),
        "avgCVR": round(cv / v * 100, 2)   if v  > 0 else None,
        "avgCPA": round(c / cv)            if cv > 0 else None,
        "avgCPC": round(c / v, 1)          if v  > 0 else None,
    }


@app.route("/api/compare", methods=["POST"])
def compare_api():
    f_t = request.files.get("target")
    f_c = request.files.get("compare")
    if not f_t or not f_c:
        return jsonify({"error": "対象データと比較データの両方をアップロードしてください"}), 400

    errs, t_rows, c_rows = [], None, None
    try:
        t_rows = _parse_compare_csv(_decode_file(f_t))
    except Exception as e:
        errs.append(f"対象データ: {e}")
    try:
        c_rows = _parse_compare_csv(_decode_file(f_c))
    except Exception as e:
        errs.append(f"比較データ: {e}")
    if errs:
        return jsonify({"error": " ／ ".join(errs)}), 400

    t_by = _channel_metrics(t_rows)
    c_by = _channel_metrics(c_rows)
    channels = sorted(set(list(t_by) + list(c_by)))

    return jsonify({
        "channels": channels,
        "target":   {ch: t_by.get(ch, {}) for ch in channels},
        "compare":  {ch: c_by.get(ch, {}) for ch in channels},
        "summary":  {"target": _compare_totals(t_rows), "compare": _compare_totals(c_rows)},
        "rowCount": {"target": len(t_rows), "compare": len(c_rows)},
    })


if __name__ == "__main__":
    app.run(debug=True, port=5000)
