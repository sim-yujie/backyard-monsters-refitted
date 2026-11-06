import { describe, expect, test } from "bun:test";
import nodemailer from "nodemailer";
import addressparser from "nodemailer/lib/addressparser";

/**
 * The two kinds of mail the server sends still build on nodemailer 10.1
 * (security audit 2026-10-29, L6): the password reset (HTML, one recipient)
 * and the bug report (text, a player's reply-to address, picture attachments).
 * Built with the stream transport and the same safety options as
 * `MailConfig.ts`, so nothing is sent. Also pins the address parser fixes the
 * upgrade is for: a reply-to address a player typed cannot add a recipient.
 */

const transport = () =>
  nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "unix",
    disableFileAccess: true,
    disableUrlAccess: true,
    maxRecipients: 1,
  });

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex"
);

describe("mail on nodemailer 10.1 (security audit 2026-10-29, L6)", () => {
  test("a password reset mail builds with its link and one recipient", async () => {
    const info = await transport().sendMail({
      from: "BYM Refitted <noreply@example.com>",
      to: "player@example.com",
      subject: "Password reset request | BYM Refitted",
      html: '<a href="https://game.example/reset-password?token=abc.def">Reset</a>',
    });
    const message = info.message.toString();

    expect(info.envelope).toEqual({ from: "noreply@example.com", to: ["player@example.com"] });
    expect(message).toContain("Subject: Password reset request | BYM Refitted");
    expect(message).toContain("reset-password?token=abc.def");
  });

  test("a bug report mail builds with its pictures attached", async () => {
    const info = await transport().sendMail({
      from: "noreply@example.com",
      to: "owner@example.com",
      replyTo: "player@example.com",
      subject: "Bug report #7: The Flinger is stuck",
      text: "Message: The Flinger is stuck",
      attachments: [
        { filename: "screenshot-7.png", content: PNG, contentType: "image/png" },
        { filename: "picture-7.png", content: PNG, contentType: "image/png" },
      ],
    });
    const message = info.message.toString();

    expect(info.envelope.to).toEqual(["owner@example.com"]);
    expect(message).toContain("Reply-To: player@example.com");
    expect(message).toContain('filename=screenshot-7.png');
    expect(message).toContain('filename=picture-7.png');
    expect(message).toContain(PNG.toString("base64").slice(0, 40));
  });

  test("a nested comment in a typed address cannot turn into the recipient (GHSA-8c8m-p3m8-cjg8)", () => {
    // 10.0.16 read this as the one address `evil@x.example)`.
    const addresses = addressparser("player@example.com (a (b) evil@x.example)") as Array<{ address?: string }>;

    expect(addresses.map((one) => one.address)).toEqual(["player@example.com"]);
  });
});
