import { parseOfficialJobText } from "../product/official-job-text";

export function OfficialJobText({ text }: { text: string }) {
  const content = parseOfficialJobText(text);

  return (
    <div className="official-job-text">
      {content.introParagraphs.length > 0 ? (
        <div className="official-job-text__intro">
          {content.introParagraphs.map((paragraph, index) => (
            <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
          ))}
        </div>
      ) : null}
      {content.numberedItems.length > 0 ? (
        <ol className="official-job-text__list">
          {content.numberedItems.map((item, index) => (
            <li key={`${index}-${item.marker}-${item.text.slice(0, 24)}`} value={item.number}>
              <span className="official-job-text__marker" aria-hidden="true">
                {item.marker}
              </span>
              <span className="official-job-text__item">{item.text}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
