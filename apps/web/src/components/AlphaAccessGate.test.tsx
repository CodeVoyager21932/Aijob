import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AlphaAccessGate } from "./AlphaAccessGate";

describe("Private Alpha access gate", () => {
  it("does not interfere with local product surfaces", () => {
    const html = renderToStaticMarkup(
      <AlphaAccessGate enabled={false}>
        <p>product-ready</p>
      </AlphaAccessGate>,
    );
    expect(html).toContain("product-ready");
    expect(html).not.toContain("访问凭证");
  });

  it("does not render product content before the Alpha session check", () => {
    const html = renderToStaticMarkup(
      <AlphaAccessGate enabled>
        <p>private-product</p>
      </AlphaAccessGate>,
    );
    expect(html).toContain("正在确认访问状态");
    expect(html).not.toContain("private-product");
  });
});
