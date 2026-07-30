export interface NumberedOfficialTextItem {
  marker: string;
  number: number;
  text: string;
}

export interface ParsedOfficialJobText {
  introParagraphs: string[];
  numberedItems: NumberedOfficialTextItem[];
}

const NUMBERED_ITEM_PATTERN =
  /(^|[\s；;。！？!?：:])(\d{1,2})([、．)]|\.(?=\s|[A-Za-z\u4e00-\u9fff]))\s*/gmu;

function splitParagraphs(value: string): string[] {
  return value
    .split(/\r?\n+/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

export function parseOfficialJobText(value: string): ParsedOfficialJobText {
  const source = value.trim();
  const markers: Array<{
    marker: string;
    markerStart: number;
    number: number;
    textStart: number;
  }> = [];

  for (const match of source.matchAll(NUMBERED_ITEM_PATTERN)) {
    const prefix = match[1] ?? "";
    const numberText = match[2];
    const punctuation = match[3];
    if (!numberText || !punctuation || match.index === undefined) continue;

    markers.push({
      marker: `${numberText}${punctuation}`,
      markerStart: match.index + prefix.length,
      number: Number(numberText),
      textStart: match.index + match[0].length,
    });
  }

  if (markers.length === 0) {
    return {
      introParagraphs: splitParagraphs(source),
      numberedItems: [],
    };
  }

  const numberedItems = markers
    .map((marker, index) => ({
      marker: marker.marker,
      number: marker.number,
      text: source.slice(marker.textStart, markers[index + 1]?.markerStart ?? source.length).trim(),
    }))
    .filter((item) => item.text.length > 0);

  if (numberedItems.length === 0) {
    return {
      introParagraphs: splitParagraphs(source),
      numberedItems: [],
    };
  }

  return {
    introParagraphs: splitParagraphs(source.slice(0, markers[0]?.markerStart ?? 0)),
    numberedItems,
  };
}
