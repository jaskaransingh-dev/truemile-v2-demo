from __future__ import annotations
import base64, io, json, logging
from PIL import Image
from pdf2image import convert_from_bytes
import anthropic
from app.config import settings

logger = logging.getLogger(__name__)
_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

_EXTRACT_PROMPT = """\
Extract rate confirmation data from this text. Return ONLY valid JSON with null for missing fields:

{
  "loadNumber": "<string | null>",
  "driverName": "<string | null>",
  "trailerType": "<DRY_VAN | REEFER | FLATBED | STEP_DECK | null>",
  "pickupCity": "<string | null>",
  "pickupState": "<2-letter code | null>",
  "pickupTime": "<YYYY-MM-DDTHH:MM:SS | null>",
  "dropoffCity": "<string | null>",
  "dropoffState": "<2-letter code | null>",
  "deliveryTime": "<YYYY-MM-DDTHH:MM:SS | null>",
  "rate": "<number | null>",
  "loadedMiles": "<number | null>",
  "deadheadMiles": "<number | null>",
  "stopCount": "<number | null>",
  "stops": [
    {
      "type": "PICKUP or DROP",
      "city": "<string>",
      "state": "<2-letter>",
      "address": "<string | null>",
      "appointment": "<YYYY-MM-DDTHH:MM:SS | null>",
      "sequence": "<integer starting at 1>"
    }
  ],
  "brokerName": "<string | null>",
  "brokerAgentName": "<string | null>",
  "brokerEmail": "<string | null>",
  "brokerPhone": "<string | null>",
  "brokerMC": "<string | null>"
}

Rules:
- rate = total carrier payout in dollars (not per-mile)
- loadedMiles = total loaded route miles
- deadheadMiles = bobtail/empty miles to pickup, if shown
- Times: naive local datetime, NO timezone — "YYYY-MM-DDTHH:MM:SS"
- pickupCity/State = first PICKUP; dropoffCity/State = last DROP
- trailerType: look for "Dry Van", "Reefer", "Refrigerated", "Flatbed", "Step Deck"
- driverName: assigned driver shown on the rate con (often blank)
- brokerName = freight broker/shipper company (not the carrier)
- brokerAgentName = individual rep at broker (not carrier contact)
- brokerEmail/Phone = broker contact (not carrier)
- stopCount = total entries in stops array

Rate con text:
{text}
"""


async def _ocr_page(image: Image.Image) -> str:
    if image.width > 1500:
        ratio = 1500 / image.width
        image = image.resize((1500, int(image.height * ratio)), Image.LANCZOS)
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    b64 = base64.standard_b64encode(buf.getvalue()).decode()
    resp = await _client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1000,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}},
                {"type": "text", "text": "Extract ALL text from this rate confirmation page verbatim. Preserve layout and spacing."},
            ],
        }],
    )
    return resp.content[0].text


async def _extract_fields(text: str) -> dict:
    resp = await _client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1500,
        temperature=0,
        messages=[{"role": "user", "content": _EXTRACT_PROMPT.replace("{text}", text[:8000])}],
    )
    raw = resp.content[0].text.strip()
    if raw.startswith("```"):
        raw = "\n".join(raw.split("\n")[1:-1])
    try:
        return json.loads(raw.strip())
    except json.JSONDecodeError:
        logger.warning("[ratecon] JSON parse failed on extraction response")
        return {}


async def parse_ratecon(data: bytes, mimetype: str = "application/pdf") -> dict:
    is_pdf = mimetype == "application/pdf" or data[:4] == b"%PDF"

    if is_pdf:
        pages = convert_from_bytes(data, dpi=150, first_page=1, last_page=1)
    else:
        pages = [Image.open(io.BytesIO(data))]

    if not pages:
        raise ValueError("Could not extract any pages from file")

    page1_text = await _ocr_page(pages[0])
    logger.info(f"[ratecon] page 1 OCR: {len(page1_text)} chars")

    if len(page1_text.strip()) < 20:
        raise ValueError("No text extracted from page 1")

    result = await _extract_fields(page1_text)

    missing = [f for f in ("rate", "pickupCity", "dropoffCity") if not result.get(f)]
    if missing and is_pdf:
        logger.info(f"[ratecon] pass 1 missing {missing} — trying pages 2-3")
        extra_pages = convert_from_bytes(data, dpi=150, first_page=2, last_page=3)
        if extra_pages:
            extra_texts = [await _ocr_page(p) for p in extra_pages]
            combined = page1_text + "\n\n" + "\n\n".join(extra_texts)
            result = await _extract_fields(combined)

    return result
