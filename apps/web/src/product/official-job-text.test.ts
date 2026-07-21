import { describe, expect, it } from "vitest";
import { parseOfficialJobText } from "./official-job-text";

describe("parseOfficialJobText", () => {
  it("separates an official introduction from numbered responsibilities", () => {
    const parsed = parseOfficialJobText(
      "ByteIntern：面向2027届毕业生。团队介绍：支持字节跳动全系产品。 1、参与业务功能开发； 2、参与需求分析； 3、保障系统稳定性。",
    );

    expect(parsed).toEqual({
      introParagraphs: ["ByteIntern：面向2027届毕业生。团队介绍：支持字节跳动全系产品。"],
      numberedItems: [
        { marker: "1、", number: 1, text: "参与业务功能开发；" },
        { marker: "2、", number: 2, text: "参与需求分析；" },
        { marker: "3、", number: 3, text: "保障系统稳定性。" },
      ],
    });
  });

  it("keeps years and tool names intact inside numbered requirements", () => {
    const parsed = parseOfficialJobText(
      "1、2027届本科及以上学历在读，计算机科学、软件工程相关专业优先；2、熟悉Go语言开发，或者有扎实的C/C++基础；3、熟悉数据库技术，如SQL、Mongo、Redis等。",
    );

    expect(parsed.introParagraphs).toEqual([]);
    expect(parsed.numberedItems).toEqual([
      {
        marker: "1、",
        number: 1,
        text: "2027届本科及以上学历在读，计算机科学、软件工程相关专业优先；",
      },
      {
        marker: "2、",
        number: 2,
        text: "熟悉Go语言开发，或者有扎实的C/C++基础；",
      },
      {
        marker: "3、",
        number: 3,
        text: "熟悉数据库技术，如SQL、Mongo、Redis等。",
      },
    ]);
  });

  it("supports common explicit numbering styles without treating decimals as list markers", () => {
    const parsed = parseOfficialJobText(
      "项目说明。1. 第一项需要连续实习3.5个月； 2．第二项； 3) 第三项。",
    );

    expect(parsed.introParagraphs).toEqual(["项目说明。"]);
    expect(parsed.numberedItems).toEqual([
      { marker: "1.", number: 1, text: "第一项需要连续实习3.5个月；" },
      { marker: "2．", number: 2, text: "第二项；" },
      { marker: "3)", number: 3, text: "第三项。" },
    ]);
  });

  it("falls back to official line breaks when no numbered items exist", () => {
    expect(parseOfficialJobText("负责用户研究。\n支持跨团队协作。")).toEqual({
      introParagraphs: ["负责用户研究。", "支持跨团队协作。"],
      numberedItems: [],
    });
  });
});
