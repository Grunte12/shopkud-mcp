"""Bounded deterministic model-code evidence; not a product-authenticity verdict."""

import re
import unicodedata


def normalize_model(value):
    if not isinstance(value, str) or len(value) > 32:
        return None
    code = unicodedata.normalize("NFKC", value).strip().upper()
    return code if re.fullmatch(r"[A-Z][A-Z0-9-]{1,31}", code) and re.search(r"[0-9]", code) else None


def model_match(detail, target=None):
    target = normalize_model(target) if target is not None else None
    sources = {"visible_product_description", "visible_product_title", "product_json_ld_title", "product_json_ld", "visible_product_spec"}
    evidence = []
    raw = detail.get("model_evidence")
    for item in (raw if isinstance(raw, list) else [])[:12]:
        if not isinstance(item, dict):
            continue
        code = normalize_model(item.get("model"))
        if not code or item.get("source") not in sources or item.get("role") not in {"identity", "compatible", "mention"} or not isinstance(item.get("snippet"), str):
            continue
        evidence.append({"model": code, "source": item["source"], "snippet": item["snippet"][:180], "role": item["role"]})
    models = sorted({item["model"] for item in evidence if item["role"] == "identity"})
    status = "ambiguous" if len(models) > 1 else "detected" if models and target is None else "matched" if models and models[0] == target else "different" if models else "accessory_only" if any(item["role"] == "compatible" for item in evidence) else "unknown"
    relevant = [item for item in evidence if item["role"] == "identity"] or evidence
    # Keep one source per distinct model before adding corroboration.
    selected = []
    for item in relevant:
        if not any(old["model"] == item["model"] for old in selected):
            selected.append(item)
    for item in relevant:
        if item not in selected:
            selected.append(item)
    return {"status": status, "target_model": target, "detected_model": models[0] if len(models) == 1 else None, "evidence": selected[:3]}


def brief_listing(detail, target=None):
    variant = detail.get("variant_info")
    variant = variant if isinstance(variant, dict) else {}
    compact_variant = {key: variant[key][:240] if isinstance(variant.get(key), str) else None for key in ("model", "sku", "color")}
    selected = variant.get("selected_options")
    compact_variant["selected_options"] = [{"label": item["label"][:80], "value": item["value"][:120], "source": item["source"]}
                                           for item in (selected if isinstance(selected, list) else [])[:4]
                                           if isinstance(item, dict) and isinstance(item.get("label"), str) and isinstance(item.get("value"), str)
                                           and item.get("source") in {"visible_aria_checked", "visible_aria_selection"}]
    compact_variant["available_options"] = []
    groups = variant.get("available_options")
    for group in (groups if isinstance(groups, list) else [])[:4]:
        if not isinstance(group, dict):
            continue
        options = group.get("options")
        compact_group = {"label": str(group.get("label", ""))[:80], "options": [value[:120] for value in (options if isinstance(options, list) else [])[:8] if isinstance(value, str)]}
        states = group.get("option_evidence")
        if isinstance(states, list):
            compact_group["option_evidence"] = [{"value": item["value"][:120], "selected": item.get("selected") if type(item.get("selected")) is bool else None,
                                                 "disabled": item["disabled"] if type(item.get("disabled")) is bool else None, "source": item["source"]}
                                                for item in states[:8] if isinstance(item, dict) and isinstance(item.get("value"), str)
                                                and item.get("source") in {"visible_labeled_buttons", "visible_aria_checked"}]
        compact_variant["available_options"].append(compact_group)
    purchase = {}
    for key, fields, sources in (
        ("seller_info", ("name", "mall_badge", "ratings_count", "followers", "shop_age", "response_rate", "response_time"), {"visible_seller_panel"}),
        ("product_metrics", ("rating", "review_count", "rating_count", "sold"), {"visible_product_summary", "exact_product_json_ld"}),
        ("shipping_info", ("ships_from", "delivery", "shipping_fee", "stock"), {"visible_product_summary"}),
    ):
        raw = detail.get(key)
        raw = raw if isinstance(raw, dict) else {}
        purchase[key] = {}
        for field in fields:
            item = raw.get(field)
            purchase[key][field] = {"display": item["display"][:120], "source": item["source"]} if isinstance(item, dict) and isinstance(item.get("display"), str) and item.get("source") in sources else None
    layout = detail.get("layout_evidence")
    return {**{key: detail.get(key) for key in ("ok", "kind", "source_url", "shop_id", "product_id", "observed_at", "name")}, "model_match": model_match(detail, target), "variant_info": compact_variant, **purchase, "reader_revision": layout.get("reader_revision") if isinstance(layout, dict) else None, "retry_automatically": False}
