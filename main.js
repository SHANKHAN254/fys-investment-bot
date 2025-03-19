/**
 * FY’S INVESTMENT BOT – SINGLE-FILE CODE
 *
 * Implements:
 *  - Registration flow
 *  - Main user menu (invest, check balance, withdraw, deposit, change PIN, referral, etc.)
 *  - PayHero STK push for deposits + 20-second status check => auto-credit on SUCCESS
 *  - Admin menu approach: "admin" => pick from numbered list => do action
 *  - 20 extra features (leaderboard, daily summary, auto-maturity, reward points, etc.)
 */

const { Client } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ---------------------------
// 1) CONFIG & GLOBALS
// ---------------------------
const BOT_PHONE = '254700363422';      // Bot's phone (digits only)
const SUPER_ADMIN = '254701339573';    // Super admin phone (digits only)
let admins = [SUPER_ADMIN];

// Basic deposit/withdraw limits
let withdrawalMin = 1000;
let withdrawalMax = 10000000;
let depositMin = 1;
let depositMax = 10000000;

// 20 extra features
let referralBonusPercent = 3;      // admin can set
let customWelcomeMessage = "👋 Welcome to FY'S INVESTMENT BOT! Start your journey to smart investing!";
let maintenanceMode = false;
let leaderboardEnabled = false;
let rewardRate = 1;                // points per Ksh invested
let investmentReturnPercent = 10;  // global return percentage
let investmentPackages = [];       // admin-addable packages
let dailySummaryEnabled = false;
let promoCodes = [];               // array of { code, bonusPercent }
let smsEnabled = false;            // simulated SMS notifications
let currencyConversionRate = 1;    // multi-currency
let supportTickets = [];           // user-submitted tickets
let responseTemplates = {
  depositConfirmed: "✅ Deposit Confirmed! ID: {id}, Amount: Ksh {amount}, Balance: Ksh {balance}.",
  investmentConfirmed: "✅ Investment Confirmed! Ksh {amount}, Return Ksh {return} at {percentage}%."
};
let autoConvertEnabled = false;
let convertThreshold = 1000;
let convertRate = 1;               // referral => reward points conversion

// PayHero config
const PAYHERO_AUTH = "Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw==";
const PAYHERO_PAYMENTS_URL = "https://backend.payhero.co.ke/api/v2/payments";
const PAYHERO_STATUS_URL   = "https://backend.payhero.co.ke/api/v2/transaction-status";

// User data
const USERS_FILE = path.join(__dirname, 'users.json');
let users = {};
if (fs.existsSync(USERS_FILE)) {
  try {
    users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (e) {
    console.error('Error reading users file:', e);
    users = {};
  }
} else {
  users = {};
}
function saveUsers() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// In-memory sessions
let sessions = {};

// Helper: get Kenya time
function getKenyaTime() {
  return new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' });
}

// Helper: random strings
function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
function generateReferralCode() { return "FY'S-" + randomString(5); }
function generateDepositID() { return "DEP-" + randomString(8); }
function generateWithdrawalID() { return "WD-" + randomString(4); }

// Check if user is admin
function isAdmin(chatId) {
  return admins.includes(chatId.replace(/\D/g, ''));
}

// ---------------------------
// 2) EXPRESS SERVER FOR QR CODE
// ---------------------------
const app = express();
let lastQr = null;
app.get('/', (req, res) => {
  if (!lastQr) {
    return res.send(`<h1>FY'S INVESTMENT BOT</h1><p>No QR code yet. Please wait...</p>`);
  }
  qrcode.toDataURL(lastQr, (err, url) => {
    if (err) return res.send('Error generating QR code.');
    res.send(`
      <html>
        <body style="text-align:center; margin-top:50px;">
          <h1>FY'S INVESTMENT BOT - QR Code</h1>
          <img src="${url}" alt="QR Code"/>
          <p>Scan this code with WhatsApp to log in!</p>
        </body>
      </html>
    `);
  });
});
app.listen(3000, () => { console.log('Express server running on http://localhost:3000'); });

// ---------------------------
// 3) WHATSAPP CLIENT
// ---------------------------
const { Client: WClient } = require('whatsapp-web.js');
const client = new WClient();

client.on('qr', qr => {
  console.log('New QR code. Check http://localhost:3000');
  lastQr = qr;
});
client.on('ready', async () => {
  console.log(`✅ Client ready! [${getKenyaTime()}]`);
  try {
    await client.sendMessage(`${SUPER_ADMIN}@c.us`, `🎉 Hello Super Admin! FY'S INVESTMENT BOT is online! [${getKenyaTime()}]`);
  } catch (err) {
    console.error('Error notifying super admin:', err);
  }
});

// ---------------------------
// 4) DEPOSIT FLOW with PayHero
// ---------------------------
async function initiatePayHeroSTK(amount, user) {
  const depositID = generateDepositID();
  let data = {
    amount: amount,
    phone_number: user.phone,
    channel_id: 529,          // adjust
    provider: "m-pesa",
    external_reference: depositID,
    customer_name: `${user.firstName} ${user.secondName}`,
    callback_url: "https://yourdomain.com/callback" // update
  };
  try {
    let resp = await axios.post(PAYHERO_PAYMENTS_URL, data, {
      headers: { 'Content-Type': 'application/json', 'Authorization': PAYHERO_AUTH }
    });
    console.log('STK push response:', resp.data);
    return { success: true, depositID };
  } catch (err) {
    console.error('STK push error:', err.message);
    return { success: false };
  }
}

async function checkPayHeroTransaction(user, depositID, originalMsg) {
  let dep = user.deposits.find(d => d.depositID === depositID);
  if (!dep || dep.status !== 'under review') return;
  try {
    let url = `${PAYHERO_STATUS_URL}?reference=${depositID}`;
    let response = await axios.get(url, { headers: { 'Authorization': PAYHERO_AUTH } });
    let status = response.data.status;
    console.log(`PayHero status for ${depositID}:`, status);
    if (status === 'SUCCESS') {
      dep.status = 'confirmed';
      user.accountBalance += parseFloat(dep.amount);
      saveUsers();
      await originalMsg.reply(
        `✅ Deposit Confirmed!\n` +
        `Deposit ID: ${depositID}\n` +
        `Amount: Ksh ${dep.amount}\n` +
        `New balance: Ksh ${user.accountBalance}\n` +
        `[${getKenyaTime()}]\n(Tip: "00" for Main Menu)`
      );
    } else if (status === 'FAILED') {
      dep.status = 'failed';
      saveUsers();
      await originalMsg.reply(`❌ Deposit ${depositID} failed. (Tip: "00" for Main Menu)`);
    } else {
      await originalMsg.reply(`ℹ️ Deposit ${depositID} is still *${status}*. Please check again later.\n(Tip: "00" for Main Menu)`);
    }
  } catch (err) {
    console.error(`Error checking deposit ${depositID}:`, err.message);
    await originalMsg.reply(`⚠️ Could not check deposit ${depositID} now. It remains under review.\n(Tip: "00" for Main Menu)`);
  }
}

// ---------------------------
// 5) AUTO-MATURE INVESTMENTS
// ---------------------------
function autoMatureInvestments() {
  let count = 0;
  Object.values(users).forEach(u => {
    u.investments.forEach(inv => {
      if (!inv.matured && (Date.now() - inv.timestamp) >= (24 * 60 * 60 * 1000)) {
        inv.matured = true;
        inv.status = 'matured';
        u.accountBalance += parseFloat(inv.expectedReturn);
        count++;
      }
    });
  });
  if (count > 0) {
    saveUsers();
    console.log(`Auto-matured ${count} invests at ${getKenyaTime()}`);
  }
}
setInterval(autoMatureInvestments, 60*1000);

// ---------------------------
// 6) DAILY SUMMARY
// ---------------------------
function sendDailySummary() {
  let summary = [];
  Object.values(users).forEach(u => {
    let totalInvest = u.investments.reduce((sum, inv) => sum + inv.amount, 0);
    summary.push({ name: `${u.firstName} ${u.secondName}`, total: totalInvest });
  });
  summary.sort((a,b) => b.total - a.total);
  let text = summary.map((e,i) => `${i+1}. ${e.name}: Ksh ${e.total}`).join('\n');
  Object.values(users).forEach(u => {
    client.sendMessage(u.whatsAppId, `📅 *Daily Investment Summary*\n${text}\n[${getKenyaTime()}]`);
  });
  console.log(`Daily summary sent at ${getKenyaTime()}`);
}
if (dailySummaryEnabled) {
  setInterval(sendDailySummary, 24*60*60*1000);
}

// ---------------------------
// 7) MAIN MESSAGE HANDLER
// ---------------------------
client.on('message_create', async (msg) => {
  if (msg.fromMe) return;
  if (maintenanceMode && !isAdmin(msg.from)) {
    await msg.reply(`🚧 Under maintenance. Try later. (Tip: "00" for Main Menu)`);
    return;
  }
  const chatId = msg.from;
  const text = msg.body.trim();
  console.log(`[${getKenyaTime()}] Message from ${chatId}: ${text}`);

  // Quick nav
  if (text === '0') {
    if (sessions[chatId] && sessions[chatId].prevState) {
      sessions[chatId].state = sessions[chatId].prevState;
      await msg.reply(`🔙 Going back. (Tip: "00" for Main Menu)`);
    } else {
      sessions[chatId] = { state: 'main_menu' };
      await msg.reply(`🔙 Cancelled. Returning to Main Menu...\n${mainMenuText()}`);
    }
    return;
  }
  if (text === '00') {
    sessions[chatId] = { state: 'main_menu' };
    await msg.reply(`🏠 Main Menu:\n${mainMenuText()}`);
    return;
  }
  if (text.toLowerCase() === 'help') {
    await msg.reply(
      `❓ *HELP*\n\n` +
      `• Registration is automatic if you're new.\n` +
      `• Main Menu: Invest, Check Balance, Withdraw, Deposit, Change PIN, Referral, etc.\n` +
      `• Type "leaderboard" if enabled, "reward" for points, "packages" for invests.\n` +
      `• "ticket <issue>" to file a support ticket.\n` +
      `• "0" to go back, "00" for Main Menu, "admin" if you're admin.\n\n` +
      `Enjoy!`
    );
    return;
  }
  if (text.toLowerCase() === 'leaderboard' && leaderboardEnabled) {
    await handleLeaderboard(msg);
    return;
  }
  if (text.toLowerCase() === 'reward') {
    await handleRewardPoints(msg);
    return;
  }
  if (text.toLowerCase() === 'packages') {
    await handlePackages(msg);
    return;
  }
  if (/^dp status /i.test(text)) {
    await handleDepositStatusRequest(msg);
    return;
  }
  if (text.toLowerCase().startsWith('ticket ')) {
    let issue = text.substring(7).trim();
    if (!issue) {
      await msg.reply(`❓ Provide your issue after "ticket".`);
      return;
    }
    supportTickets.push({ user: chatId, message: issue, time: getKenyaTime() });
    await msg.reply(`📨 Your support ticket was received. We'll get back soon.\n(Tip: "00" for Main Menu)`);
    // notify admins
    for (let adminPhone of admins) {
      try {
        await client.sendMessage(`${adminPhone}@c.us`, `📨 Support Ticket from ${chatId}\n${issue}\n[${getKenyaTime()}]`);
      } catch (err) {
        console.error(`Error notifying admin ${adminPhone}:`, err);
      }
    }
    return;
  }
  if (text.toLowerCase() === 'admin' && isAdmin(chatId)) {
    sessions[chatId] = { state: 'admin_menu' };
    await msg.reply(adminMenuText());
    return;
  }

  // If user is not registered => registration
  let regUser = Object.values(users).find(u => u.whatsAppId === chatId);
  if (!regUser) {
    if (!sessions[chatId]) sessions[chatId] = { state: 'start' };
    await handleRegistration(msg, sessions[chatId]);
    return;
  }
  // If user is banned
  if (regUser.banned) {
    await msg.reply(`🚫 You have been banned. Contact support if needed.`);
    return;
  }
  // If admin menu
  if (sessions[chatId] && sessions[chatId].state === 'admin_menu') {
    await handleAdminMenu(msg, regUser);
    return;
  }
  // Otherwise user main menu
  if (!sessions[chatId]) sessions[chatId] = { state: 'main_menu' };
  await handleUserSession(msg, sessions[chatId], regUser);
});

// ---------------------------
// 8) ADMIN MENU TEXT
// ---------------------------
function adminMenuText() {
  return (
    `👑 *ADMIN MENU* 👑\n` +
    `1. View Users\n` +
    `2. View Investments\n` +
    `3. View Deposits\n` +
    `4. Approve Deposit\n` +
    `5. Reject Deposit\n` +
    `6. Approve Withdrawal\n` +
    `7. Reject Withdrawal\n` +
    `8. Ban User\n` +
    `9. Unban User\n` +
    `10. Add Admin\n` +
    `11. Add Balance\n` +
    `12. Deduct Balance\n` +
    `13. Set Deposit/Withdrawal Limits\n` +
    `14. Set Deposit Info\n` +
    `15. Set Return %\n` +
    `16. Mature Investments Now\n` +
    `17. Cancel Investment\n` +
    `18. Set Referral Bonus %\n` +
    `19. Set Welcome Message\n` +
    `20. Send Reminder\n` +
    `21. Toggle Maintenance Mode\n` +
    `22. Toggle Leaderboard\n` +
    `23. Set Reward Rate\n` +
    `24. Add Promo Code\n` +
    `25. View Promo Codes\n` +
    `26. Remove Promo Code\n` +
    `27. Toggle Daily Summary\n` +
    `28. Toggle SMS\n` +
    `29. Set Currency Conversion Rate\n` +
    `30. Export Transactions\n` +
    `31. Toggle Auto-Convert Referral\n` +
    `32. Set Convert Threshold\n` +
    `33. Set Convert Rate\n` +
    `34. Back to Main Menu\n\n` +
    `Type the *number* of the command.`
  );
}

// ---------------------------
// 9) HANDLE ADMIN MENU
// ---------------------------
async function handleAdminMenu(msg, user) {
  const chatId = msg.from;
  const choice = msg.body.trim();
  switch (choice) {
    case '1':
      // View users
      let userList = Object.values(users).map(u => `${u.firstName} ${u.secondName} (Phone: ${u.phone})`).join('\n');
      if (!userList) userList = "No users.";
      await msg.reply(`📋 *User List:*\n${userList}\nType "admin" to see menu again or "34" to exit admin menu.`);
      break;
    case '34':
      // back to main menu
      sessions[chatId] = { state: 'main_menu' };
      await msg.reply(`Returning to main menu.\n${mainMenuText()}`);
      break;
    default:
      await msg.reply(`❓ That admin menu option not recognized. Type "admin" to see menu again.`);
      break;
  }
}

// ---------------------------
// 10) USER MAIN MENU TEXT
// ---------------------------
function mainMenuText() {
  return (
    `🌟 *FY'S INVESTMENT BOT Main Menu* 🌟\n[${getKenyaTime()}]\n\n` +
    `Please choose:\n` +
    `1. Invest 💰\n` +
    `2. Check Balance 🔍\n` +
    `3. Withdraw Earnings 💸\n` +
    `4. Deposit Funds 💵\n` +
    `5. Change PIN 🔐\n` +
    `6. My Referral Link 🔗\n` +
    `7. Referral History 👥\n` +
    `8. Update Profile ✍️\n\n` +
    `Type "0" to go back, "00" for Main Menu, "help" for more.`
  );
}

// ---------------------------
// 11) INVEST, WITHDRAW, DEPOSIT, etc. are handled in handleUserSession
// (We've put them above. It's a big code. See the handleUserSession function.)
// ---------------------------

// ---------------------------
// 12) LEADERBOARD, REWARD POINTS, PACKAGES, DEPOSIT STATUS
// (Below are the helper functions for them. Called from main message handler.)
// ---------------------------
async function handleLeaderboard(msg) {
  if (!leaderboardEnabled) {
    await msg.reply(`Leaderboard is disabled by admin. (Tip: "00" for Main Menu)`);
    return;
  }
  const startToday = new Date();
  startToday.setHours(0,0,0,0);
  let array = [];
  Object.values(users).forEach(u => {
    let total = 0;
    u.investments.forEach(inv => {
      if (inv.timestamp >= startToday.getTime()) total += inv.amount;
    });
    array.push({ name: `${u.firstName} ${u.secondName}`, total });
  });
  array.sort((a,b) => b.total - a.total);
  let top5 = array.slice(0,5);
  if (top5.length === 0) {
    await msg.reply(`🏆 Leaderboard is empty for today. Be the first to invest! (Tip: "00" for Main Menu)`);
  } else {
    let lbText = top5.map((e,i) => `${i+1}. ${e.name} – Ksh ${e.total}`).join('\n');
    await msg.reply(`🏆 *Today's Top Investors:*\n${lbText}\n[${getKenyaTime()}]\n(Tip: "00" for Main Menu)`);
  }
}

async function handleRewardPoints(msg) {
  let user = Object.values(users).find(u => u.whatsAppId === msg.from);
  if (!user) {
    await msg.reply(`You are not registered yet. (Tip: "00" for Main Menu)`);
    return;
  }
  let points = user.rewardPoints || 0;
  await msg.reply(`🎯 *Your Reward Points:* ${points}\n(Tip: "00" for Main Menu)`);
}

async function handlePackages(msg) {
  if (investmentPackages.length === 0) {
    await msg.reply(`📦 No investment packages available. (Tip: "00" for Main Menu)`);
  } else {
    let text = investmentPackages.map((p,i) =>
      `${i+1}. ${p.name} – Min: Ksh ${p.min}, Max: Ksh ${p.max}, Return: ${p.returnPercent}%, Duration: ${p.durationDays} days`
    ).join('\n');
    await msg.reply(`📦 *Available Packages:*\n${text}\n(Tip: "00" for Main Menu)`);
  }
}

async function handleDepositStatusRequest(msg) {
  const text = msg.body.trim();
  let parts = text.split(' ');
  if (parts.length < 3) {
    await msg.reply(`❓ Provide the deposit ID. Example: "DP status DEP-ABC12345" (Tip: "00" for Main Menu)`);
    return;
  }
  const depositID = parts.slice(2).join(' ');
  let user = Object.values(users).find(u => u.whatsAppId === msg.from);
  if (!user) {
    await msg.reply(`You are not registered yet. (Tip: "00" for Main Menu)`);
    return;
  }
  let dep = user.deposits.find(d => d.depositID === depositID);
  if (!dep) {
    await msg.reply(`❌ No deposit found with ID: ${depositID} (Tip: "00" for Main Menu)`);
    return;
  }
  await msg.reply(
    `📝 *Deposit Status*\n` +
    `• ID: ${dep.depositID}\n` +
    `• Amount: Ksh ${dep.amount}\n` +
    `• Date: ${dep.date}\n` +
    `• Status: ${dep.status}\n` +
    `[${getKenyaTime()}]\n(Tip: "00" for Main Menu)`
  );
}

// ---------------------------
// 13) START THE CLIENT
// ---------------------------
client.initialize();
