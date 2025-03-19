/**
 * FY’S DEPOSIT BOT
 *
 * Flow:
 *  1. User enters deposit amount (min 1, max 10000).
 *  2. After 3s, user enters phone (07 or 01, 10 digits).
 *  3. STK push via PayHero => reference = deposit ID.
 *  4. Alert admin => 254701339573.
 *  5. After 20s => check transaction status => if SUCCESS => show Mpesa code.
 *
 * Admin Commands:
 *   - admin setmin <amount>
 *   - admin setwelcome <message>
 *   - admin depositlist
 *   - admin message <phones> <msg>
 */

////////////////////////////
// Section 1: Imports & Config
////////////////////////////
const { Client } = require("whatsapp-web.js");
const express = require("express");
const qrcode = require("qrcode");
const qrcodeTerminal = require("qrcode-terminal");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// Admin
const SUPER_ADMIN = "254701339573";
let admins = [SUPER_ADMIN];

// Deposit constraints
let depositMin = 1;
let depositMax = 10000;
let customWelcomeMessage = "👋 Welcome to FY'S DEPOSIT BOT! Please enter the amount (1 - 10000).";

// PayHero config
const PAYHERO_AUTH = "Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw==";
const PAYHERO_PAYMENTS_URL = "https://backend.payhero.co.ke/api/v2/payments";
const PAYHERO_STATUS_URL   = "https://backend.payhero.co.ke/api/v2/transaction-status";
const CHANNEL_ID = 529; // adjust if needed

// Data structure for deposit attempts
// Each: { userId, amount, phone, depositID, status, mpesaCode, timestamp }
let depositAttempts = [];

// Session states
let sessions = {};

////////////////////////////
// Section 2: Helper Functions
////////////////////////////
function getKenyaTime() {
  return new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" });
}
function randomString(len) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let res = "";
  for (let i = 0; i < len; i++) {
    res += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return res;
}
function generateDepositID() {
  return "DEP-" + randomString(8);
}
function isAdmin(chatId) {
  return admins.includes(chatId.replace(/\D/g, ""));
}
function updateSessionState(session, newState) {
  session.prevState = session.state;
  session.state = newState;
}

// Save deposit attempts to a file
const DEPOSITS_FILE = path.join(__dirname, "deposits.json");
function saveDeposits() {
  fs.writeFileSync(DEPOSITS_FILE, JSON.stringify(depositAttempts, null, 2));
}
if (fs.existsSync(DEPOSITS_FILE)) {
  try {
    depositAttempts = JSON.parse(fs.readFileSync(DEPOSITS_FILE, "utf8"));
  } catch (err) {
    console.error("Error reading deposits file:", err);
    depositAttempts = [];
  }
}

////////////////////////////
// Section 3: Express & QR Code Webpage
////////////////////////////
const app = express();
let lastQr = null;
app.get("/", (req, res) => {
  if (!lastQr) {
    return res.send(`
      <html>
        <head><title>FY'S PROPERTY</title></head>
        <body style="text-align:center; margin-top:50px; font-family:sans-serif;">
          <h1>FY'S PROPERTY</h1>
          <p>No QR code yet. Please wait...</p>
        </body>
      </html>
    `);
  }
  qrcode.toDataURL(lastQr, (err, url) => {
    if (err) return res.send("Error generating QR code.");
    res.send(`
      <html>
        <head>
          <title>FY'S PROPERTY</title>
          <style>
            body { background: linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%); text-align:center; padding-top:50px; font-family:Arial; }
            h1 { color:#2c3e50; margin-bottom:20px; }
            p { color:#34495e; font-size:18px; }
            img { border:4px solid #2c3e50; border-radius:8px; }
          </style>
        </head>
        <body>
          <h1>FY'S PROPERTY</h1>
          <img src="${url}" alt="QR Code"/>
          <p>📱 Scan this QR code with WhatsApp to connect!</p>
        </body>
      </html>
    `);
  });
});
app.listen(3000, () => {
  console.log("Express server running at http://localhost:3000");
});

////////////////////////////
// Section 4: WhatsApp Client
////////////////////////////
const { Client: WClient } = require("whatsapp-web.js");
const client = new WClient();

client.on("qr", (qr) => {
  qrcodeTerminal.generate(qr, { small: true });
  console.log("Scan the QR above or open http://localhost:3000 for a color QR code page.");
  lastQr = qr;
});
client.on("ready", async () => {
  console.log(`✅ WhatsApp client ready! [${getKenyaTime()}]`);
  try {
    await client.sendMessage(`${SUPER_ADMIN}@c.us`, `🎉 FY'S DEPOSIT BOT is online! [${getKenyaTime()}]`);
  } catch (err) {
    console.error("Error alerting admin:", err);
  }
});

////////////////////////////
// Section 5: STK Push & Status Check
////////////////////////////
async function initiateSTKPush(amount, phone) {
  let depositID = generateDepositID();
  let payload = {
    amount: amount,
    phone_number: phone,
    channel_id: CHANNEL_ID,
    provider: "m-pesa",
    external_reference: depositID, // so we can query by depositID
    customer_name: "Deposit Request",
    callback_url: "https://yourdomain.com/callback" // update if needed
  };
  try {
    let resp = await axios.post(PAYHERO_PAYMENTS_URL, payload, {
      headers: {
        "Content-Type": "application/json",
        Authorization: PAYHERO_AUTH
      }
    });
    console.log("STK push response:", resp.data);
    return { success: true, depositID };
  } catch (err) {
    console.error("Error initiating STK push:", err.message);
    return { success: false, depositID: generateDepositID() };
  }
}

// Check transaction status after 20 seconds
async function checkTransactionStatus(depositID, originalMsg) {
  let dep = depositAttempts.find(d => d.depositID === depositID);
  if (!dep || dep.status !== "under review") return;
  try {
    let url = `${PAYHERO_STATUS_URL}?reference=${depositID}`;
    let response = await axios.get(url, {
      headers: {
        Authorization: PAYHERO_AUTH
      }
    });
    console.log(`Transaction status for ${depositID}:`, response.data);
    // Example response fields:
    // {
    //   "transaction_date": "2024-11-26T08:41:14.160604Z",
    //   "provider": "m-pesa",
    //   "success": true,
    //   "merchant": "Ron Doe",
    //   "payment_reference": "",
    //   "third_party_reference": "SKQ96C7K7H",
    //   "status": "SUCCESS",
    //   "reference": "6b71cb8b-638d-4b6e-9c7c-b0334a641e3a",
    //   "provider_reference": "SKQ96C7K7H"
    // }
    let status = response.data.status;
    let providerRef = response.data.provider_reference || response.data.third_party_reference || "N/A";
    
    if (status === "SUCCESS") {
      dep.status = "confirmed";
      dep.mpesaCode = providerRef; // store the M-Pesa code
      saveDeposits();
      await originalMsg.reply(`✅ Your deposit (ID: ${dep.depositID}) of Ksh ${dep.amount} was successful!\nMPESA Code: ${providerRef}\nThank you! 🎉`);
    } else if (status === "FAILED") {
      dep.status = "failed";
      saveDeposits();
      await originalMsg.reply(`❌ Your deposit (ID: ${dep.depositID}) failed. Please try again later.`);
    } else {
      // e.g. QUEUED or anything else => not processed
      await originalMsg.reply(`ℹ️ Your deposit (ID: ${dep.depositID}) is *${status}*. MPESA Code: ${providerRef}\nPlease check again later.`);
    }
  } catch (err) {
    console.error("Error checking transaction status:", err.message);
    await originalMsg.reply(`⚠️ Could not check deposit status. It remains under review.`);
  }
}

////////////////////////////
// Section 6: Admin Command Processing
////////////////////////////
async function processAdminCommand(msg) {
  let parts = msg.body.trim().split(" ");
  if (parts.length < 2) {
    await msg.reply("❓ Please specify an admin command after 'admin'.");
    return;
  }
  let cmd = parts[1].toLowerCase();
  switch (cmd) {
    case "setmin":
      if (parts.length < 3) {
        await msg.reply("❓ Usage: admin setmin <minimum deposit amount>");
      } else {
        let newMin = parseFloat(parts[2]);
        if (isNaN(newMin) || newMin < 1) {
          await msg.reply("❌ Invalid minimum amount.");
        } else {
          depositMin = newMin;
          await msg.reply(`✅ Deposit minimum updated to Ksh ${depositMin}.`);
        }
      }
      break;
    case "setwelcome":
      if (parts.length < 3) {
        await msg.reply("❓ Usage: admin setwelcome <new welcome message>");
      } else {
        customWelcomeMessage = parts.slice(2).join(" ");
        await msg.reply(`✅ Welcome message updated to:\n${customWelcomeMessage}`);
      }
      break;
    case "depositlist":
      if (depositAttempts.length === 0) {
        await msg.reply("📋 No deposit attempts recorded.");
      } else {
        let list = depositAttempts
          .map((d, i) => `${i + 1}. ID: ${d.depositID} | Amount: Ksh ${d.amount} | Status: ${d.status} | Code: ${d.mpesaCode || "N/A"} | Time: ${d.timestamp}`)
          .join("\n");
        await msg.reply(`📋 Deposit Attempts:\n${list}`);
      }
      break;
    case "message":
      // admin message <phone1,phone2,...> <your message>
      if (parts.length < 4) {
        await msg.reply("❓ Usage: admin message <comma separated phone numbers> <your message>");
      } else {
        let phones = parts[2].split(",");
        let adminMsg = parts.slice(3).join(" ");
        // For demonstration, we'll just say we "sent" a message
        for (let ph of phones) {
          await msg.reply(`✅ Simulated sending message to phone ${ph}:\n"${adminMsg}"`);
        }
      }
      break;
    default:
      await msg.reply("❓ Unrecognized admin command. Options: setmin, setwelcome, depositlist, message");
      break;
  }
}

////////////////////////////
// Section 7: Main WhatsApp Handler
////////////////////////////
client.on("message_create", async (msg) => {
  if (msg.fromMe) return;
  
  // If message is an admin command
  if (msg.body.trim().toLowerCase().startsWith("admin")) {
    if (isAdmin(msg.from)) {
      await processAdminCommand(msg);
    } else {
      await msg.reply("🚫 You are not authorized to use admin commands.");
    }
    return;
  }
  
  // If no session for user, start deposit flow
  if (!sessions[msg.from]) {
    sessions[msg.from] = { state: "awaiting_amount" };
    await msg.reply(customWelcomeMessage);
    return;
  }
  
  let session = sessions[msg.from];
  
  if (session.state === "awaiting_amount") {
    let amount = parseFloat(msg.body.trim());
    if (isNaN(amount) || amount < depositMin || amount > depositMax) {
      await msg.reply(`❌ Invalid amount. Must be between Ksh ${depositMin} and Ksh ${depositMax}.`);
      return;
    }
    session.amount = amount;
    await msg.reply(`⏳ Great! You want to deposit Ksh ${amount}. Please wait 3 seconds...`);
    setTimeout(async () => {
      session.state = "awaiting_phone";
      await msg.reply("📞 Now enter your phone number (start with 07 or 01, exactly 10 digits) to receive STK push.");
    }, 3000);
    return;
  }
  
  if (session.state === "awaiting_phone") {
    let phone = msg.body.trim();
    if (!/^(07|01)\d{8}$/.test(phone)) {
      await msg.reply("❌ Invalid phone number! Must start 07 or 01, 10 digits. Try again.");
      return;
    }
    session.phone = phone;
    // Initiate STK push
    await msg.reply(`📲 Initiating STK push to ${phone} for Ksh ${session.amount}...`);
    let stkResp = await initiateSTKPush(session.amount, phone);
    let depositID = stkResp.depositID;
    let depositRec = {
      userId: msg.from,
      amount: session.amount,
      phone: phone,
      depositID: depositID,
      status: stkResp.success ? "under review" : "failed",
      mpesaCode: null,
      timestamp: getKenyaTime()
    };
    depositAttempts.push(depositRec);
    saveDeposits();
    // Alert admin
    try {
      await client.sendMessage(`${SUPER_ADMIN}@c.us`, `🔔 Deposit Alert:\nUser: ${msg.from}\nPhone: ${phone}\nAmount: Ksh ${session.amount}\nDeposit ID: ${depositID}\nTime: ${depositRec.timestamp}`);
    } catch (err) {
      console.error("Error alerting admin:", err);
    }
    if (stkResp.success) {
      await msg.reply(`💳 STK push sent! We'll check status in ~20 seconds. Please wait...`);
      setTimeout(async () => {
        await checkTransactionStatus(depositID, msg);
      }, 20000);
    } else {
      await msg.reply("❌ STK push failed. Please try again later.");
    }
    sessions[msg.from] = { state: "main_menu" };
    return;
  }
  
  // "DP status <DEP-ID>"
  if (/^dp status /i.test(msg.body.trim())) {
    let parts = msg.body.trim().split(" ");
    if (parts.length < 3) {
      await msg.reply("❓ Usage: DP status <DEP-ID>");
      return;
    }
    let depID = parts.slice(2).join(" ");
    let found = depositAttempts.find(d => d.depositID === depID);
    if (!found) {
      await msg.reply(`❌ No deposit found with ID: ${depID}`);
    } else {
      let code = found.mpesaCode || "N/A";
      await msg.reply(`📝 Deposit Status:\nID: ${found.depositID}\nAmount: Ksh ${found.amount}\nStatus: ${found.status}\nMPESA Code: ${code}\nTime: ${found.timestamp}`);
    }
    return;
  }
  
  // "00" => main menu fallback
  if (msg.body.trim() === "00") {
    sessions[msg.from] = { state: "main_menu" };
    await msg.reply("🏠 Main Menu: Type a deposit amount to begin the deposit flow again, or 'DP status <DEP-ID>' to check status.");
    return;
  }
  
  // Default fallback
  await msg.reply("❓ I'm not sure what you mean. Type your deposit amount or '00' for main menu.");
});

//////////////////////
// Section 8: Start the Client
//////////////////////
client.initialize();
