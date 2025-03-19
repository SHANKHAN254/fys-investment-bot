/**
 * FY'S DEPOSIT BOT
 *
 * USER FLOW:
 * 1. Bot asks for deposit amount (min depositMin, max 10,000).
 * 2. After 3s, it prompts for the phone number (must start with 07 or 01, exactly 10 digits).
 * 3. Initiates an STK push via PayHero.
 * 4. Alerts admin (default: 254701339573).
 * 5. After 20s, it fetches the transaction status using the provided auth for status.
 *    The API response is displayed to the user (including MPESA transaction code).
 * 6. At any time, a user can type "Start" to begin the deposit process again.
 *
 * ADMIN COMMANDS (message starts with "admin"):
 * - admin setmin <amount>      → Set deposit minimum amount.
 * - admin setwelcome <message> → Update the welcome message.
 * - admin depositlist          → View all deposit attempts.
 * - admin message <phones> <msg> → Send a message to specified users (comma-separated phone numbers).
 * - If admin sends "admin", a numbered admin menu is shown.
 *
 * The Express webpage is styled as "FY'S PROPERTY" with a colorful design and displays the QR code.
 * The QR code is also printed as ASCII in the console.
 */

//////////////////////////////
// Section 1: Imports & Global Variables
//////////////////////////////
const { Client } = require("whatsapp-web.js");
const express = require("express");
const qrcode = require("qrcode");
const qrcodeTerminal = require("qrcode-terminal");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// Admin settings
const SUPER_ADMIN = "254701339573";
let admins = [SUPER_ADMIN];

// Deposit configuration (editable by admin)
let depositMin = 1;
const depositMax = 10000;
let customWelcomeMessage = "👋 Welcome to FY'S DEPOSIT BOT! Please enter the amount you wish to deposit (min " + depositMin + ", max 10000).";

// Data structure for deposit attempts
// Each deposit: { userId, amount, phone, depositID, status, mpesaCode, timestamp }
let depositAttempts = [];

// In-memory sessions for users (by WhatsApp ID)
let sessions = {};

// PayHero configuration
// For STK push, we assume a default auth (you may update this if needed)
// For checking transaction status, we use the provided auth:
const PAYHERO_STATUS_AUTH = "Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw==";
const PAYHERO_PAYMENTS_URL = "https://backend.payhero.co.ke/api/v2/payments";
const PAYHERO_STATUS_URL   = "https://backend.payhero.co.ke/api/v2/transaction-status";
const CHANNEL_ID = 529; // adjust if needed

// File to save deposit attempts
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

//////////////////////////////
// Section 2: Helper Functions
//////////////////////////////
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

//////////////////////////////
// Section 3: Express Server & QR Code Webpage ("FY'S PROPERTY")
//////////////////////////////
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
            body { background: linear-gradient(135deg, #f6d365, #fda085); font-family: Arial, sans-serif; text-align: center; padding-top: 50px; color: #2c3e50; }
            h1 { font-size: 48px; margin-bottom: 20px; }
            p { font-size: 20px; }
            img { border: 5px solid #2c3e50; border-radius: 10px; }
          </style>
        </head>
        <body>
          <h1>FY'S PROPERTY</h1>
          <img src="${url}" alt="QR Code"/>
          <p>📱 Scan this QR code with WhatsApp to connect with FY'S DEPOSIT BOT!</p>
        </body>
      </html>
    `);
  });
});
app.listen(3000, () => {
  console.log("Express server running at http://localhost:3000");
});

//////////////////////////////
// Section 4: WhatsApp Client Initialization
//////////////////////////////
const { Client: WClient } = require("whatsapp-web.js");
const client = new WClient();
client.on("qr", (qr) => {
  // Print QR code in ASCII to console
  qrcodeTerminal.generate(qr, { small: true });
  console.log("Scan the QR above or visit http://localhost:3000 for a colorful QR code page.");
  lastQr = qr;
});
client.on("ready", async () => {
  console.log(`✅ WhatsApp Client is ready! [${getKenyaTime()}]`);
  try {
    await client.sendMessage(`${SUPER_ADMIN}@c.us`, `🎉 FY'S DEPOSIT BOT is now online! [${getKenyaTime()}]`);
  } catch (err) {
    console.error("Error notifying admin:", err);
  }
});

//////////////////////////////
// Section 5: PayHero STK Push & Transaction Status Check
//////////////////////////////
async function initiateSTKPush(amount, phone) {
  const depositID = generateDepositID();
  let payload = {
    amount: amount,
    phone_number: phone,
    channel_id: CHANNEL_ID,
    provider: "m-pesa",
    external_reference: depositID,
    customer_name: "Deposit Request",
    callback_url: "https://yourdomain.com/callback" // UPDATE this URL accordingly
  };
  try {
    let resp = await axios.post(PAYHERO_PAYMENTS_URL, payload, {
      headers: {
        "Content-Type": "application/json",
        // For STK push, we assume the same auth is used; you can adjust if needed.
        Authorization: QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw==,
      },
    });
    console.log("STK push response:", resp.data);
    return { success: true, depositID };
  } catch (err) {
    console.error("Error initiating STK push:", err.message);
    return { success: false, depositID: generateDepositID() };
  }
}

async function checkTransactionStatus(depositID, originalMsg) {
  let dep = depositAttempts.find(d => d.depositID === depositID);
  if (!dep || dep.status !== "under review") return;
  try {
    let url = `${PAYHERO_STATUS_URL}?reference=${depositID}`;
    let response = await axios.get(url, {
      headers: { Authorization: PAYHERO_STATUS_AUTH }
    });
    console.log("Transaction status response:", response.data);
    let status = response.data.status;
    let transactionDate = response.data.transaction_date || "N/A";
    let provider = response.data.provider || "N/A";
    let merchant = response.data.merchant || "N/A";
    let mpesaCode = response.data.provider_reference || response.data.third_party_reference || "N/A";
    
    if (status === "SUCCESS") {
      dep.status = "confirmed";
      dep.mpesaCode = mpesaCode;
      saveDeposits();
      await originalMsg.reply(`✅ Your deposit (ID: ${dep.depositID}) of Ksh ${dep.amount} was successful!\nTransaction Date: ${transactionDate}\nProvider: ${provider}\nMerchant: ${merchant}\nMPESA Code: ${mpesaCode}\nThank you! 🎉`);
    } else if (status === "FAILED") {
      dep.status = "failed";
      saveDeposits();
      await originalMsg.reply(`❌ Your deposit (ID: ${dep.depositID}) failed. Please try again later.`);
    } else {
      await originalMsg.reply(`ℹ️ Your deposit (ID: ${dep.depositID}) is currently ${status}.\nTransaction Date: ${transactionDate}\nMPESA Code: ${mpesaCode}\nPlease check again later.`);
    }
  } catch (err) {
    console.error("Error checking transaction status:", err.message);
    await originalMsg.reply(`⚠️ Unable to check deposit status now. It remains under review.`);
  }
}

//////////////////////////////
// Section 6: Admin Command Processing & Menu
//////////////////////////////
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
          .map((d, i) => `${i + 1}. ID: ${d.depositID} | Amount: Ksh ${d.amount} | Status: ${d.status} | MPESA Code: ${d.mpesaCode || "N/A"} | Time: ${d.timestamp}`)
          .join("\n");
        await msg.reply(`📋 Deposit Attempts:\n${list}`);
      }
      break;
    case "message":
      if (parts.length < 4) {
        await msg.reply("❓ Usage: admin message <comma separated phone numbers> <your message>");
      } else {
        let phones = parts[2].split(",");
        let adminMsg = parts.slice(3).join(" ");
        for (let ph of phones) {
          let userRec = Object.values(users).find(u => u.phone === ph);
          if (userRec) {
            try {
              await client.sendMessage(userRec.whatsAppId, `📢 Message from Admin: ${adminMsg}`);
            } catch (err) {
              console.error("Error sending message to user:", err);
            }
          }
        }
        await msg.reply("✅ Message sent to specified users.");
      }
      break;
    default:
      await msg.reply("❓ Unrecognized admin command. Options: setmin, setwelcome, depositlist, message");
      break;
  }
}

async function showAdminMenu(msg) {
  let menu = 
`👑 *ADMIN MENU* 👑
1. Set Deposit Minimum Amount
2. Set Welcome Message
3. View Deposit Attempts
4. Message Users
5. Back to Main Menu
Type the number of your choice.`;
  await msg.reply(menu);
  sessions[msg.from] = { state: "admin_menu" };
}

client.on("message_create", async (msg) => {
  if (msg.body.trim().toLowerCase() === "admin") {
    if (isAdmin(msg.from)) {
      await showAdminMenu(msg);
    } else {
      await msg.reply("🚫 You are not authorized to use admin commands.");
    }
    return;
  }
  if (sessions[msg.from] && sessions[msg.from].state === "admin_menu" && isAdmin(msg.from)) {
    let choice = msg.body.trim();
    switch (choice) {
      case "1":
        await msg.reply("Please type: `admin setmin <amount>` to set the new deposit minimum.");
        sessions[msg.from].state = "idle";
        break;
      case "2":
        await msg.reply("Please type: `admin setwelcome <new welcome message>` to update the welcome message.");
        sessions[msg.from].state = "idle";
        break;
      case "3":
        await processAdminCommand({ body: "admin depositlist", from: msg.from });
        sessions[msg.from].state = "idle";
        break;
      case "4":
        await msg.reply("Please type: `admin message <phone1,phone2,...> <your message>` to message users.");
        sessions[msg.from].state = "idle";
        break;
      case "5":
        sessions[msg.from] = { state: "main_menu" };
        await msg.reply("Returning to Main Menu.");
        break;
      default:
        await msg.reply("❓ Invalid option. Please choose a number from 1 to 5.");
        break;
    }
    return;
  }
});

//////////////////////////////
// Section 7: Main WhatsApp Handler – Deposit Flow
//////////////////////////////
client.on("message_create", async (msg) => {
  if (msg.fromMe) return;
  // Skip if admin command already processed
  if (msg.body.trim().toLowerCase().startsWith("admin")) return;
  
  // Allow user to type "Start" to begin deposit flow again.
  if (msg.body.trim().toLowerCase() === "start") {
    sessions[msg.from] = { state: "awaiting_amount" };
    await msg.reply(customWelcomeMessage);
    return;
  }
  
  // Start deposit flow if no session exists
  if (!sessions[msg.from]) {
    sessions[msg.from] = { state: "awaiting_amount" };
    await msg.reply(customWelcomeMessage);
    return;
  }
  
  let session = sessions[msg.from];
  
  if (session.state === "awaiting_amount") {
    let amount = parseFloat(msg.body.trim());
    if (isNaN(amount) || amount < depositMin || amount > depositMax) {
      await msg.reply(`❌ Invalid amount. Please enter a value between Ksh ${depositMin} and Ksh ${depositMax}.`);
      return;
    }
    session.amount = amount;
    await msg.reply(`⏳ Great! You want to deposit Ksh ${amount}. Please wait 3 seconds...`);
    setTimeout(async () => {
      session.state = "awaiting_phone";
      await msg.reply("📞 Now, please enter your phone number (must start with 07 or 01 and be exactly 10 digits) to receive the STK push.");
    }, 3000);
    return;
  }
  
  if (session.state === "awaiting_phone") {
    let phone = msg.body.trim();
    if (!/^(07|01)\d{8}$/.test(phone)) {
      await msg.reply("❌ Invalid phone number! It must start with 07 or 01 and be exactly 10 digits. Please try again.");
      return;
    }
    session.phone = phone;
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
      await msg.reply(`💳 STK push sent! We'll check the transaction status in ~20 seconds. Please wait...`);
      setTimeout(async () => {
        await checkTransactionStatus(depositID, msg);
      }, 20000);
    } else {
      await msg.reply("❌ STK push failed. Please try again later.");
    }
    sessions[msg.from] = { state: "main_menu" };
    return;
  }
  
  // "DP status <DEP-ID>" to check deposit status manually
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
  
  // "00" resets to main menu
  if (msg.body.trim() === "00") {
    sessions[msg.from] = { state: "main_menu" };
    await msg.reply("🏠 Main Menu: To deposit again, simply enter the deposit amount or type 'Start'.");
    return;
  }
  
  // Default fallback
  await msg.reply("❓ Please enter your deposit amount or type '00' for Main Menu.");
});

//////////////////////////////
// Section 8: Start the Client
//////////////////////////////
client.initialize();
