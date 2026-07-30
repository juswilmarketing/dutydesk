/**
 * DutyDesk — Gmail send webhook (Google Apps Script) v4
 *
 * Sends FROM brokerage@pastrinidad.com using Gmail Send-As API (not GmailApp).
 *
 * Setup:
 * 1. script.google.com → paste this file
 * 2. Services (+) → Gmail API → Add
 * 3. Script properties → WEBHOOK_SECRET
 * 4. Deploy → Web app (Execute as: Me | Anyone)
 * 5. Gmail → Send mail as → brokerage@pastrinidad.com verified
 * 6. npx wrangler secret put GOOGLE_SCRIPT_URL  ← paste THIS deployment /exec URL
 * 7. Run doGet once → authorize
 */

var SCRIPT_VERSION = 4;

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function parseRequestData(e) {
  if (e && e.parameter && e.parameter.payload) {
    return JSON.parse(e.parameter.payload);
  }
  if (e && e.postData && e.postData.contents) {
    return JSON.parse(e.postData.contents);
  }
  return {};
}

function guessMime(filename) {
  var ext = String(filename || "")
    .split(".")
    .pop()
    .toLowerCase();
  var map = {
    html: "text/html",
    htm: "text/html",
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xml: "application/xml",
    txt: "text/plain",
  };
  return map[ext] || "application/octet-stream";
}

function formatAddress(name, email) {
  var safeName = String(name || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  if (safeName) return '"' + safeName + '" <' + email + ">";
  return email;
}

function encodeMimeHeader(value) {
  var text = String(value || "");
  if (/^[\x00-\x7F]*$/.test(text)) return text;
  return "=?UTF-8?B?" + Utilities.base64Encode(text, Utilities.Charset.UTF_8) + "?=";
}

function chunkBase64(b64) {
  var out = [];
  for (var i = 0; i < b64.length; i += 76) {
    out.push(b64.substring(i, i + 76));
  }
  return out.join("\r\n");
}

function buildRawMime(data) {
  var fromName = data.fromName || "PAS Trinidad Brokerage Department";
  var fromAddress = String(data.fromAddress || "brokerage@pastrinidad.com").trim();
  var replyTo = String(data.replyTo || fromAddress).trim();
  var mixedBoundary = "=_DutyDesk_mixed_" + Utilities.getUuid().replace(/-/g, "");
  var altBoundary = "=_DutyDesk_alt_" + Utilities.getUuid().replace(/-/g, "");
  var attachments = data.attachments || [];
  var plainBody = "Please view this message in HTML format. Full tax advice is attached.";
  var htmlBody = String(data.html || "");

  var lines = [];
  lines.push("From: " + formatAddress(fromName, fromAddress));
  lines.push("To: " + data.to);
  if (data.cc) lines.push("Cc: " + data.cc);
  lines.push("Reply-To: " + formatAddress(fromName, replyTo));
  lines.push("Subject: " + encodeMimeHeader(data.subject));
  lines.push("MIME-Version: 1.0");

  if (attachments.length === 0) {
    lines.push("Content-Type: text/html; charset=UTF-8");
    lines.push("Content-Transfer-Encoding: base64");
    lines.push("");
    lines.push(chunkBase64(Utilities.base64Encode(htmlBody, Utilities.Charset.UTF_8)));
  } else {
    lines.push('Content-Type: multipart/mixed; boundary="' + mixedBoundary + '"');
    lines.push("");
    lines.push("--" + mixedBoundary);
    lines.push('Content-Type: multipart/alternative; boundary="' + altBoundary + '"');
    lines.push("");
    lines.push("--" + altBoundary);
    lines.push("Content-Type: text/plain; charset=UTF-8");
    lines.push("Content-Transfer-Encoding: base64");
    lines.push("");
    lines.push(chunkBase64(Utilities.base64Encode(plainBody, Utilities.Charset.UTF_8)));
    lines.push("--" + altBoundary);
    lines.push("Content-Type: text/html; charset=UTF-8");
    lines.push("Content-Transfer-Encoding: base64");
    lines.push("");
    lines.push(chunkBase64(Utilities.base64Encode(htmlBody, Utilities.Charset.UTF_8)));
    lines.push("--" + altBoundary + "--");

    attachments.forEach(function (item) {
      var filename = item.filename || "attachment";
      var mimeType = item.mimeType || guessMime(filename);
      lines.push("--" + mixedBoundary);
      lines.push('Content-Type: ' + mimeType + '; name="' + filename + '"');
      lines.push('Content-Disposition: attachment; filename="' + filename + '"');
      lines.push("Content-Transfer-Encoding: base64");
      lines.push("");
      lines.push(chunkBase64(String(item.content || "")));
    });

    lines.push("--" + mixedBoundary + "--");
  }

  return lines.join("\r\n");
}

function listSendAsAliases() {
  try {
    var res = Gmail.Users.Settings.SendAs.list("me");
    return (res.sendAs || []).map(function (a) {
      return {
        email: a.sendAsEmail,
        primary: a.isPrimary,
        default: a.isDefault,
        verification: a.verificationStatus,
        displayName: a.displayName,
      };
    });
  } catch (err) {
    return { error: err && err.message ? err.message : String(err) };
  }
}

/** Send using the Send-As alias endpoint — required for brokerage@ to appear as From. */
function sendAsAlias(fromAddress, rawMessage) {
  var encoded = Utilities.base64EncodeWebSafe(rawMessage).replace(/=+$/, "");
  var resource = { raw: encoded };

  // Preferred: Gmail Advanced Service SendAs.send
  try {
    if (Gmail.Users.Settings.SendAs.send) {
      Gmail.Users.Settings.SendAs.send(resource, "me", fromAddress);
      return { method: "SendAs.send" };
    }
  } catch (e1) {
    // fall through to UrlFetchApp
  }

  // Fallback: REST API with script OAuth token
  var url =
    "https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs/" +
    encodeURIComponent(fromAddress) +
    "/send";
  var resp = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    payload: JSON.stringify(resource),
    muteHttpExceptions: true,
  });
  var code = resp.getResponseCode();
  var body = resp.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error("SendAs API " + code + ": " + body);
  }
  return { method: "SendAs REST" };
}

function sendEmailPayload(data) {
  var fromAddress = String(data.fromAddress || "brokerage@pastrinidad.com").trim();
  var aliases = listSendAsAliases();
  var verified = Array.isArray(aliases)
    ? aliases.some(function (a) {
        return a.email === fromAddress && a.verification === "accepted";
      })
    : false;

  if (!verified) {
    throw new Error(
      "Send-as alias " +
        fromAddress +
        " is not verified in Gmail. Check Settings → Accounts → Send mail as.",
    );
  }

  var rawMessage = buildRawMime(data);
  var result = sendAsAlias(fromAddress, rawMessage);
  return { from: fromAddress, method: result.method };
}

function doPost(e) {
  try {
    var expectedSecret = PropertiesService.getScriptProperties().getProperty("WEBHOOK_SECRET");
    var data = parseRequestData(e);

    if (expectedSecret && data.secret !== expectedSecret) {
      return jsonResponse({ error: "Unauthorized", version: SCRIPT_VERSION });
    }

    if (data.ping) {
      return jsonResponse({
        ok: true,
        ping: true,
        version: SCRIPT_VERSION,
        sendAs: listSendAsAliases(),
      });
    }

    var to = String(data.to || "").trim();
    var subject = String(data.subject || "").trim();
    var html = String(data.html || "").trim();

    if (!to || to.indexOf("@") < 1) return jsonResponse({ error: "Valid recipient required", version: SCRIPT_VERSION });
    if (!subject) return jsonResponse({ error: "Subject required", version: SCRIPT_VERSION });
    if (!html) return jsonResponse({ error: "HTML body required", version: SCRIPT_VERSION });

    var payload = {
      fromName: data.fromName || "PAS Trinidad Brokerage Department",
      fromAddress: String(data.fromAddress || "brokerage@pastrinidad.com").trim(),
      replyTo: String(data.replyTo || data.fromAddress || "brokerage@pastrinidad.com").trim(),
      to: to,
      cc: String(data.cc || "").trim(),
      subject: subject,
      html: html,
      attachments: data.attachments || [],
    };

    var sent = sendEmailPayload(payload);
    return jsonResponse({ ok: true, version: SCRIPT_VERSION, from: sent.from, method: sent.method });
  } catch (err) {
    return jsonResponse({
      error: err && err.message ? err.message : String(err),
      version: SCRIPT_VERSION,
    });
  }
}

function doGet() {
  return jsonResponse({
    ok: true,
    version: SCRIPT_VERSION,
    service: "DutyDesk Gmail webhook",
    sendAs: listSendAsAliases(),
  });
}
