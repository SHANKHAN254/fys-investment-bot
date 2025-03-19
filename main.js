/**
 * FY'S DEPOSIT BOT
 *
 * USER FLOW:
 *  1. When a user first contacts the bot, it asks for the deposit amount (min 1, max 10,000).
 *  2. After 3 seconds, it prompts for the phone number (must start with 07 or 01, exactly 10 digits).
 *  3. Initiates an STK push via PayHero.
 *  4. Sends an alert message to admin (default: 254701339573).
 *  5. After 20 seconds, checks the deposit status and gives the user feedback with emojis.
 *
 * ADMIN COMMANDS (send a message starting with "admin"):
 *  - admin setmin <amount>        => set deposit minimum
 *  - admin setwelcome <message>   => set custom welcome message
 *  - admin depositlist            => view all deposit attempts
 *  - admin message <phones> <msg> => send a message to specified users
 *
 * The Express webpage is styled as "FY'S PROPERTY" and displays a color QR code.
 * The QR code is also printed in the console (ASCII) using qrcode-terminal.
 */

//////////////////////
// Section 1: Imports & Globals
//////////////////////
const { Client } = require("whatsapp-web.js");
const express = require("express");
const qrcode = require("qrcode");
const qrcodeTerminal = require("qrcode-terminal");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// Admin and Bot Config
const SUPER_ADMIN = "254701339573"; // Admin phone
let admins = [SUPER_ADMIN];
let depositMin = 1;
let depositMax = 10000;
let customWelcomeMessage = "👋 Welcome to FY'S DEPOSIT BOT! Please enter the amount you wish to deposit (min 1, max 10,000).";

// PayHero config (update callback_url if needed)
const PAYHERO_AUTH = "Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw==";
const PAYHERO_PAYMENTS_URL = "https://backend.payhero.co.ke/api/v2/payments";
const PAYHERO_STATUS_URL   = "https://backend.payhero.co.ke/api/v2/transaction-status";
const CHANNEL_ID = 529;

// Data structure to store deposit attempts
// Each deposit: { userId, amount, phone, depositID, status, timestamp }
let depositAttempts = [];

// In-memory session states (by WhatsApp ID)
let sessions = {};

//////////////////////
// Section 2: Helper Functions
//////////////////////
function getKenyaTime() {
  return new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" });
}
function randomString(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
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

//////////////////////
// Section 3: Express Server & QR Code Webpage
//////////////////////
const app = express();
let lastQr = null;
app.get("/", (req, res) => {
  if (!lastQr) {
    return res.send(`
      <html>
        <head><title>FY'S PROPERTY</title></head>
        <body style="text-align:center; padding-top:50px; font-family:Arial,sans-serif;">
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
            body { background: linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%); text-align:center; padding-top:50px; font-family:Arial,sans-serif; }
            h1 { color:#2c3e50; margin-bottom:20px; }
            p { color:#34495e; font-size:18px; }
            img { border:4px solid #2c3e50; border-radius:8px; }
          </style>
        </head>
        <body>
          <h1>FY'S PROPERTY</h1>
          <img src="${url}" alt="QR Code" />
          <p>📱 Scan this QR code with WhatsApp to connect!</p>
        </body>
      </html>
    `);
  });
});
app.listen(3000, () => {
  console.log("Express server running at http://localhost:3000");
});

//////////////////////
// Section 4: WhatsApp Client Initialization
//////////////////////
const { Client: WClient } = require("whatsapp-web.js");
const client = new WClient();

client.on("qr", (qr) => {
  // Print the QR code in ASCII to console
  qrcodeTerminal.generate(qr, { small: true });
  console.log("Scan the QR code above or open http://localhost:3000 to view a colorful QR code page.");
  lastQr = qr;
});

client.on("ready", async () => {
  console.log(`✅ WhatsApp client ready! [${getKenyaTime()}]`);
  try {
    await client.sendMessage(`${SUPER_ADMIN}@c.us`, `🎉 FY'S DEPOSIT BOT is now online! [${getKenyaTime()}]`);
  } catch (err) {
    console.error("Error notifying admin:", err);
  }
});

//////////////////////
// Section 5: PayHero STK Push & Status Check
//////////////////////
async function initiateSTKPush(amount, phone) {
  const depositID = generateDepositID();
  const payload = {
    amount: amount,
    phone_number: phone,
    channel_id: CHANNEL_ID,
    provider: "m-pesa",
    external_reference: depositID,
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
    return { success: false };
  }
}

async function checkTransactionStatus(depositID, originalMsg) {
  let dep = depositAttempts.find(d => d.depositID === depositID);
  if (!dep || dep.status !== "under review") return;
  try {
    let url = `${PAYHERO_STATUS_URL}?reference=${depositID}`;
    let response = await axios.get(url, {
      headers: { Authorization: PAYHERO_AUTH }
    });
    let status = response.data.status;
    console.log(`Status for deposit ${depositID}:`, status);
    if (status === "SUCCESS") {
      dep.status = "confirmed";
      saveDeposits();
      await originalMsg.reply(`✅ Your deposit (ID: ${depositID}) of Ksh ${dep.amount} was successful! 🎉`);
    } else if (status === "FAILED") {
      dep.status = "failed";
      saveDeposits();
      await originalMsg.reply(`❌ Your deposit (ID: ${depositID}) failed. Please try again later.`);
    } else {
      await originalMsg.reply(`ℹ️ Your deposit (ID: ${depositID}) is still *${status}*. Please check again later.`);
    }
  } catch (err) {
    console.error("Error checking deposit status:", err.message);
    await originalMsg.reply(`⚠️ Could not check deposit status now. It remains under review.`);
  }
}

//////////////////////
// Section 6: Admin Command Processor
//////////////////////
async function processAdminCommand(msg) {
  let parts = msg.body.trim().split(" ");
  if (parts.length < 2) {
    await msg.reply("❓ Please specify an admin command after 'admin'.");
    return;
  }
  let cmd = parts[1].toLowerCase();
  switch (cmd) {
    case "setmin":
      // admin setmin X
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
      // admin setwelcome <message>
      if (parts.length < 3) {
        await msg.reply("❓ Usage: admin setwelcome <new welcome message>");
      } else {
        customWelcomeMessage = parts.slice(2).join(" ");
        await msg.reply(`✅ Welcome message updated to:\n${customWelcomeMessage}`);
      }
      break;
    case "depositlist":
      // admin depositlist
      if (depositAttempts.length === 0) {
        await msg.reply("📋 No deposit attempts found.");
      } else {
        let list = depositAttempts
          .map((d, i) => `${i + 1}. ID: ${d.depositID} | Amount: Ksh ${d.amount} | Status: ${d.status} | Time: ${d.timestamp}`)
          .join("\n");
        await msg.reply(`📋 Deposit Attempts:\n${list}`);
      }
      break;
    case "message":
      // admin message <phone1,phone2,...> <msg>
      if (parts.length < 4) {
        await msg.reply("❓ Usage: admin message <comma separated phone numbers> <your message>");
      } else {
        let phones = parts[2].split(",");
        let adminMsg = parts.slice(3).join(" ");
        // In this simplified code, we don't store user phone => userId in a map.
        // We can just send a direct message if we had the user's WhatsApp ID, but let's simulate.
        // If you stored a user map (phone => WhatsApp ID), you could retrieve it. For now, just do a direct mention.
        for (let ph of phones) {
          // Just notify admin that we "messaged" them (in real usage, you'd store phone => user ID).
          await msg.reply(`✅ Simulated sending message to phone ${ph}:\n"${adminMsg}"`);
        }
      }
      break;
    default:
      await msg.reply("❓ Unrecognized admin command. Options: setmin, setwelcome, depositlist, message");
      break;
  }
}

//////////////////////
// Section 7: Main WhatsApp Message Handler
//////////////////////
client.on("message_create", async (msg) => {
  if (msg.fromMe) return;

  // Admin commands
  if (msg.body.trim().toLowerCase().startsWith("admin")) {
    if (isAdmin(msg.from)) {
      await processAdminCommand(msg);
    } else {
      await msg.reply("🚫 You are not authorized to use admin commands.");
    }
    return;
  }
  
  // If no session for this user, start deposit flow
  if (!sessions[msg.from]) {
    sessions[msg.from] = { state: "awaiting_amount" };
    await msg.reply(customWelcomeMessage);
    return;
  }
  
  let session = sessions[msg.from];
  
  // Deposit Flow
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
      await msg.reply("📞 Now enter your phone number (must start with 07 or 01, exactly 10 digits) to receive STK push.");
    }, 3000);
    return;
  }
  
  if (session.state === "awaiting_phone") {
    let phone = msg.body.trim();
    if (!/^(07|01)\d{8}$/.test(phone)) {
      await msg.reply("❌ Invalid phone number! Must start 07 or 01 and be exactly 10 digits. Try again.");
      return;
    }
    session.phone = phone;
    await msg.reply(`📲 Initiating STK push to ${phone} for Ksh ${session.amount}...`);
    let stkResp = await initiateSTKPush(session.amount, phone);
    let depositID = stkResp.success ? stkResp.depositID : generateDepositID();
    let depositRec = {
      userId: msg.from,
      amount: session.amount,
      phone: phone,
      depositID: depositID,
      status: stkResp.success ? "under review" : "failed",
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
  
  // "DP status <DEP-ID>" to check deposit status
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
      await msg.reply(`📝 Deposit Status:\nID: ${found.depositID}\nAmount: Ksh ${found.amount}\nStatus: ${found.status}\nTime: ${found.timestamp}`);
    }
    return;
  }
  
  // "00" => main menu fallback
  if (msg.body.trim() === "00") {
    sessions[msg.from] = { state: "main_menu" };
    await msg.reply("🏠 Main Menu: You can re-enter the deposit flow by simply typing your desired deposit amount again.");
    return;
  }
  
  // Default fallback
  await msg.reply("❓ I'm not sure what you mean. Type your deposit amount, '00' for main menu, or 'admin' if you're an admin.");
});

//////////////////////
// Section 8: Start the Client
//////////////////////
client.initialize();
