import { describe, expect, it } from "vitest";
import { approvedCompanyEmail } from "./application-methods.js";

describe("official account company email application", () => {
  it("accepts only an email on the evidenced organization domain", () => {
    expect(
      approvedCompanyEmail(
        {
          applicationEmail: "campus@jobs.example.com",
          applicationEmailSourceText: "请将简历发送至 campus@jobs.example.com",
        },
        "example.com",
      ),
    ).toEqual({
      type: "company_email",
      email: "campus@jobs.example.com",
      sourceText: "请将简历发送至 campus@jobs.example.com",
    });
  });

  it("rejects personal mailboxes and email values without an exact source excerpt", () => {
    expect(
      approvedCompanyEmail(
        {
          applicationEmail: "recruiter@qq.com",
          applicationEmailSourceText: "联系招聘负责人",
        },
        "example.com",
      ),
    ).toBeNull();
    expect(
      approvedCompanyEmail({ applicationEmail: "jobs@example.com" }, "example.com"),
    ).toBeNull();
    expect(
      approvedCompanyEmail(
        {
          applicationEmail: "jobs@example.com",
          applicationEmailSourceText: "请将简历发送至 campus@example.com",
        },
        "example.com",
      ),
    ).toBeNull();
  });
});
