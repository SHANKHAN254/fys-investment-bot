/**
 * FY'S DEPOSIT BOT
 *
 * User Flow:
 *  - At first contact, the bot asks for the deposit amount (min 1, max 10,000).
 *  - After 3 seconds, it prompts for the phone number (must start with 07 or 01, exactly 10 digits).
 *  - Initiates an STK push via PayHero.
 *  - Sends an alert message to admin (254701339573).
 *  - After 20 seconds, it checks the transaction status and gives the user feedback.
 *
 * Admin Commands (send message starting with "admin"):
 *  - admin setmin <amount>   → Set deposit minimum.
 *  - admin setwelcome <msg>   → Set custom welcome message.
 *  - admin depositlist        → View all deposit attempts.
 *  - admin message <phones> <msg> → Send a message to specified users (comma separated phone numbers).
 *
 * The QR code webpage is styled as "FY'S PROPERTY" (with beautiful colors) and the QR code is printed to console.
 */

//////////////////////////
// Section 1: Imports & Globals
//////////////////////////
const { Client } = require("whatsapp-web.js");
const express = require("express");
const qrcode = require("qrcode");
const qrcodeTerminal = require("qrcode-terminal");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// Bot settings
const BOT_PHONE_DEFAULT = "254700363422"; // used in referral links if needed
let BOT_PHONE = BOT_PHONE_DEFAULT;
const SUPER_ADMIN = "254701339573"; // admin number
let admins = [SUPER_ADMIN];

// Deposit limits and welcome message (editable by admin)
let depositMin = 1;
let depositMax = 10000;
let customWelcomeMessage = "👋 Welcome to FY'S DEPOSIT BOT! Please enter the amount you wish to deposit.";

// Array to store deposit attempts
// Each deposit: { userId, amount, phone, depositID, status, timestamp }
let depositAttempts = [];

// In-memory sessions (by WhatsApp ID)
let sessions = {};

// PayHero configuration (update callback_url as needed)
const PAYHERO_AUTH = "Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw==";
const PAYHERO_PAYMENTS_URL = "https://backend.payhero.co.ke/api/v2/payments";
const PAYHERO_STATUS_URL = "https://backend.payhero.co.ke/api/v2/transaction-status";
const CHANNEL_ID = 529;

//////////////////////////
// Section 2: Helper Functions
//////////////////////////
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

//////////////////////////
// Section 3: Express Server & QR Code Webpage ("FY'S PROPERTY")
//////////////////////////
const app = express();
let lastQr = null;
app.get("/", (req, res) => {
  qrcode.toDataURL(lastQr, (err, url) => {
    if (err) return res.send("Error generating QR code.");
    res.send(`
      <html>
        <head>
          <title>FY'S PROPERTY</title>
          <style>
            body { font-family: 'Helvetica Neue', sans-serif; background: linear-gradient(135deg, #f6d365 0%, #fda085 100%); color: #2c3e50; text-align: center; padding-top: 50px; }
            h1 { font-size: 48px; margin-bottom: 20px; }
            p { font-size: 20px; }
            img { border: 5px solid #2c3e50; border-radius: 10px; }
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
  console.log("Express server running on http://localhost:3000");
});

//////////////////////////
// Section 4: WhatsApp Client Initialization
//////////////////////////
const { Client: WClient } = require("whatsapp-web.js");
const client = new WClient();
client.on("qr", (qr) => {
  // Display QR code in console in ASCII
  qrcodeTerminal.generate(qr, { small: true });
  console.log("Scan the QR code above or visit http://localhost:3000 to view the colorful QR page.");
  lastQr = qr;
});
client.on("ready", async () => {
  console.log(`✅ WhatsApp Client is ready! [${getKenyaTime()}]`);
  try {
    await client.sendMessage(`${SUPER_ADMIN}@c.us`, `🎉 FY'S DEPOSIT BOT is now online! [${getKenyaTime()}]`);
  } catch (err) {
    console.error("Error sending message to admin:", err);
  }
});

//////////////////////////
// Section 5: Deposit Flow with PayHero
//////////////////////////
// Initiate STK push
async function initiateSTKPush(amount, user) {
  const depositID = generateDepositID();
  let data = {
    amount: amount,
    phone_number: user.phone,
    channel_id: CHANNEL_ID,
    provider: "m-pesa",
    external_reference: depositID,
    customer_name: "Deposit Request",
    callback_url: "https://yourdomain.com/callback" // UPDATE with your real callback URL
  };
  try {
    let response = await axios.post(PAYHERO_PAYMENTS_URL, data, {
      headers: {
        "Content-Type": "application/json",
        Authorization: PAYHERO_AUTH
      }
    });
    console.log("STK push response:", response.data);
    return { success: true, depositID };
  } catch (err) {
    console.error("Error initiating STK push:", err.message);
    return { success: false };
  }
}

// Check transaction status after 20 seconds
async function checkTransactionStatus(user, depositID, originalMsg) {
  let dep = depositAttempts.find((d) => d.depositID === depositID);
  if (!dep || dep.status !== "under review") return;
  try {
    let url = `${PAYHERO_STATUS_URL}?reference=${depositID}`;
    let response = await axios.get(url, { headers: { Authorization: PAYHERO_AUTH } });
    let status = response.data.status;
    console.log(`Transaction status for ${depositID}:`, status);
    if (status === "SUCCESS") {
      dep.status = "confirmed";
      saveDeposits();
      await originalMsg.reply(`✅ Your deposit (ID: ${depositID}) of Ksh ${dep.amount} was successful! Thank you! 🎉`);
    } else if (status === "FAILED") {
      dep.status = "failed";
      saveDeposits();
      await originalMsg.reply(`❌ Your deposit (ID: ${depositID}) failed. Please try again later.`);
    } else {
      await originalMsg.reply(`ℹ️ Your deposit (ID: ${depositID}) is currently ${status}. Please check again later.`);
    }
  } catch (err) {
    console.error("Error checking transaction status:", err.message);
    await originalMsg.reply(`⚠️ Unable to check deposit status now. It remains under review.`);
  }
}

// Helper to save deposit attempts
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

//////////////////////////
// Section 6: Admin Commands (Set Minimum, Set Welcome, View Deposit List, Message Users)
//////////////////////////
async function processAdminCommand(msg) {
  const parts = msg.body.trim().split(" ");
  if (parts.length < 2) {
    await msg.reply("❓ Please specify an admin command after 'admin'.");
    return;
  }
  const cmd = parts[1].toLowerCase();
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
          .map((d, i) => `${i + 1}. ID: ${d.depositID} | Amount: Ksh ${d.amount} | Status: ${d.status} | Time: ${d.timestamp}`)
          .join("\n");
        await msg.reply(`📋 Deposit Attempts:\n${list}`);
      }
      break;
    case "message":
      // Format: admin message <phone1,phone2,...> <your message>
      if (parts.length < 4) {
        await msg.reply("❓ Usage: admin message <comma separated phone numbers> <your message>");
      } else {
        let phones = parts[2].split(",");
        let adminMsg = parts.slice(3).join(" ");
        for (let ph of phones) {
          let userRecord = Object.values(users).find(u => u.phone === ph);
          if (userRecord) {
            try {
              await client.sendMessage(userRecord.whatsAppId, `📢 Message from Admin: ${adminMsg}`);
            } catch (err) {
              console.error("Error sending message to user:", err);
            }
          }
        }
        await msg.reply("✅ Message sent to specified users.");
      }
      break;
    default:
      await msg.reply("❓ Unrecognized admin command. Available: setmin, setwelcome, depositlist, message");
      break;
  }
}

//////////////////////////
// Section 7: WhatsApp Message Handler – Deposit Flow Only
//////////////////////////
client.on("message_create", async (msg) => {
  // If message is from bot itself, ignore.
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
  
  // User Deposit Flow
  // If session not created for this user, start by asking deposit amount.
  if (!sessions[msg.from]) {
    sessions[msg.from] = { state: "awaiting_deposit_amount" };
    await msg.reply(`🌟 ${customWelcomeMessage}\nPlease enter the amount you wish to deposit (min Ksh ${depositMin}, max Ksh ${depositMax}).`);
    return;
  }
  
  let session = sessions[msg.from];
  
  if (session.state === "awaiting_deposit_amount") {
    let amount = parseFloat(msg.body.trim());
    if (isNaN(amount) || amount < depositMin || amount > depositMax) {
      await msg.reply(`❌ Invalid amount. Please enter an amount between Ksh ${depositMin} and Ksh ${depositMax}.`);
      return;
    }
    session.depositAmount = amount;
    await msg.reply(`⏳ Great! You want to deposit Ksh ${amount}. Please wait 3 seconds...`);
    setTimeout(async () => {
      session.state = "awaiting_phone";
      await msg.reply(`📞 Now, please enter your phone number (must start with 07 or 01 and be exactly 10 digits) to receive the STK push.`);
    }, 3000);
    return;
  }
  
  if (session.state === "awaiting_phone") {
    let phone = msg.body.trim();
    if (!/^(07|01)\d{8}$/.test(phone)) {
      await msg.reply(`❌ Invalid phone number! It must start with 07 or 01 and be exactly 10 digits. Please try again.`);
      return;
    }
    session.phone = phone;
    await msg.reply(`📲 Initiating STK push to ${phone} for Ksh ${session.depositAmount}...`);
    // Initiate STK push
    let stkResp = await initiateSTKPush(session.depositAmount, { phone: phone, firstName: "Customer", secondName: "" });
    // Create deposit attempt record
    let depositRecord = {
      userId: msg.from,
      amount: session.depositAmount,
      phone: phone,
      depositID: stkResp.success ? stkResp.depositID : generateDepositID(),
      status: stkResp.success ? "under review" : "failed",
      timestamp: getKenyaTime(),
    };
    depositAttempts.push(depositRecord);
    saveDeposits();
    // Alert admin
    try {
      await client.sendMessage(`${SUPER_ADMIN}@c.us`, `🔔 Deposit Alert:\nUser: ${msg.from}\nPhone: ${phone}\nAmount: Ksh ${session.depositAmount}\nDeposit ID: ${depositRecord.depositID}\nTime: ${depositRecord.timestamp}`);
    } catch (err) {
      console.error("Error alerting admin:", err);
    }
    if (stkResp.success) {
      await msg.reply(`💳 STK push sent! Your deposit is being processed. We will check the status in ~20 seconds.`);
      setTimeout(async () => {
        await checkTransactionStatus({ deposits: depositAttempts }, depositRecord.depositID, msg);
      }, 20000);
    } else {
      await msg.reply(`❌ STK push failed. Please try again later.`);
    }
    sessions[msg.from] = { state: "main_menu" };
    return;
  }
  
  // Main Menu fallback
  if (msg.body.trim() === "00") {
    sessions[msg.from] = { state: "main_menu" };
    await msg.reply(`🏠 Main Menu:\n- To deposit, enter the deposit amount.\n- For deposit status, type "DP status <DEP-ID>".\n- For support, type "ticket <your issue>".`);
    return;
  }
  
  // Check deposit status command (e.g., "DP status DEP-XXXX")
  if (/^dp status /i.test(msg.body.trim())) {
    await handleDepositStatusRequest(msg);
    return;
  }
  
  // If none of the above, send a generic prompt.
  await msg.reply(`Please type "00" for the Main Menu or "help" for assistance.`);
});

//////////////////////////
// Section 8: End of Code
//////////////////////////

// End of code.
