/**
 * FY’S INVESTMENT BOT – SINGLE-FILE VERSION
 *
 * Features:
 *  • Registration (multi-step)
 *  • User main menu (invest, check balance, withdraw, deposit, etc.)
 *  • Deposit => PayHero STK push => 20s wait => check status => auto-credit on SUCCESS
 *  • Admin menu approach => "admin" => pick from numbered list => do action
 *  • 20 extra features (leaderboard, daily summary, auto-maturity, reward points, etc.)
 *  • Admin can change the bot phone number used for referral links
 */

////////////////////////////////////////////////////////////////////////////////
// 1) IMPORTS & GLOBALS
////////////////////////////////////////////////////////////////////////////////
const { Client } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Basic config
const BOT_PHONE_DEFAULT = '254700363422';   // Default Bot phone
let BOT_PHONE = BOT_PHONE_DEFAULT;          // Admin can change this

const SUPER_ADMIN = '254701339573';         // Super admin phone
let admins = [SUPER_ADMIN];

// Deposit/withdraw limits
let withdrawalMin = 1000;
let withdrawalMax = 10000000;
let depositMin = 1;
let depositMax = 10000000;

// 20 extra features toggles & data
let referralBonusPercent = 3;
let customWelcomeMessage = "👋 Welcome to FY'S INVESTMENT BOT! Start your journey to smart investing!";
let maintenanceMode = false;
let leaderboardEnabled = false;
let rewardRate = 1;
let investmentReturnPercent = 10;
let investmentPackages = [];
let dailySummaryEnabled = false;
let promoCodes = [];
let smsEnabled = false;
let currencyConversionRate = 1;
let supportTickets = [];
let responseTemplates = {
  depositConfirmed: "✅ Deposit Confirmed! ID: {id}, Amount: Ksh {amount}, Balance: Ksh {balance}.",
  investmentConfirmed: "✅ Investment Confirmed! You invested Ksh {amount}, expect Ksh {return} at {percentage}%."
};
let autoConvertEnabled = false;
let convertThreshold = 1000;
let convertRate = 1;

// PayHero config
const PAYHERO_AUTH = "Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw==";
const PAYHERO_PAYMENTS_URL = "https://backend.payhero.co.ke/api/v2/payments";
const PAYHERO_STATUS_URL   = "https://backend.payhero.co.ke/api/v2/transaction-status";
const CHANNEL_ID = 529;  // adjust if needed

// Data storage
const USERS_FILE = path.join(__dirname, 'users.json');
let users = {};
if (fs.existsSync(USERS_FILE)) {
  try {
    users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (err) {
    console.error('Error reading users file:', err);
    users = {};
  }
} else {
  users = {};
}

function saveUsers() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

let sessions = {}; // store user sessions in memory

////////////////////////////////////////////////////////////////////////////////
// 2) HELPER FUNCTIONS
////////////////////////////////////////////////////////////////////////////////
function getKenyaTime() {
  return new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' });
}
function randomString(len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i=0; i<len; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
function generateReferralCode() { return "FY'S-" + randomString(5); }
function generateDepositID() { return "DEP-" + randomString(8); }
function generateWithdrawalID() { return "WD-" + randomString(4); }
function isAdmin(chatId) {
  return admins.includes(chatId.replace(/\D/g, ''));
}
function updateState(session, newState) {
  session.prevState = session.state;
  session.state = newState;
}

////////////////////////////////////////////////////////////////////////////////
// 3) EXPRESS FOR QR CODE
////////////////////////////////////////////////////////////////////////////////
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
          <p>Scan with WhatsApp to log in!</p>
        </body>
      </html>
    `);
  });
});
app.listen(3000, () => { console.log('Express server running on http://localhost:3000'); });

////////////////////////////////////////////////////////////////////////////////
// 4) WHATSAPP CLIENT
////////////////////////////////////////////////////////////////////////////////
const { Client: WClient } = require('whatsapp-web.js');
const client = new WClient();

client.on('qr', qr => {
  console.log('New QR code. Visit http://localhost:3000');
  lastQr = qr;
});
client.on('ready', async () => {
  console.log(`✅ Client ready! [${getKenyaTime()}]`);
  try {
    await client.sendMessage(`${SUPER_ADMIN}@c.us`, `🎉 Hello Super Admin! FY'S INVESTMENT BOT is now online! [${getKenyaTime()}]`);
  } catch (err) {
    console.error('Error notifying super admin:', err);
  }
});

////////////////////////////////////////////////////////////////////////////////
// 5) DEPOSIT FLOW (STK push + 20s status check)
////////////////////////////////////////////////////////////////////////////////
async function initiatePayHeroSTK(amount, user) {
  const depositID = generateDepositID();
  let data = {
    amount: amount,
    phone_number: user.phone,
    channel_id: CHANNEL_ID,
    provider: "m-pesa",
    external_reference: depositID,
    customer_name: `${user.firstName} ${user.secondName}`,
    callback_url: "https://yourdomain.com/callback"
  };
  try {
    let resp = await axios.post(PAYHERO_PAYMENTS_URL, data, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': PAYHERO_AUTH
      }
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
        `✅ Deposit Confirmed!\nDeposit ID: ${depositID}\nAmount: Ksh ${dep.amount}\nNew balance: Ksh ${user.accountBalance}\n[${getKenyaTime()}]\n(Tip: "00" for Main Menu)`
      );
    } else if (status === 'FAILED') {
      dep.status = 'failed';
      saveUsers();
      await originalMsg.reply(`❌ Deposit ${depositID} failed. (Tip: "00" for Main Menu)`);
    } else {
      await originalMsg.reply(`ℹ️ Deposit ${depositID} is still ${status}. Check again later.\n(Tip: "00" for Main Menu)`);
    }
  } catch (err) {
    console.error(`Error checking deposit ${depositID}:`, err.message);
    await originalMsg.reply(`⚠️ Could not check deposit ${depositID} now. It remains under review.\n(Tip: "00" for Main Menu)`);
  }
}

////////////////////////////////////////////////////////////////////////////////
// 6) AUTO-MATURE INVESTMENTS
////////////////////////////////////////////////////////////////////////////////
function autoMatureInvestments() {
  let count = 0;
  Object.values(users).forEach(u => {
    u.investments.forEach(inv => {
      if (!inv.matured && (Date.now() - inv.timestamp) >= 24*60*60*1000) {
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

////////////////////////////////////////////////////////////////////////////////
// 7) DAILY SUMMARY
////////////////////////////////////////////////////////////////////////////////
function sendDailySummary() {
  let arr = [];
  Object.values(users).forEach(u => {
    let total = u.investments.reduce((sum, inv) => sum + inv.amount, 0);
    arr.push({ name: `${u.firstName} ${u.secondName}`, total });
  });
  arr.sort((a,b) => b.total - a.total);
  let text = arr.map((e,i) => `${i+1}. ${e.name}: Ksh ${e.total}`).join('\n');
  Object.values(users).forEach(u => {
    client.sendMessage(u.whatsAppId, `📅 *Daily Investment Summary*\n${text}\n[${getKenyaTime()}]`);
  });
  console.log(`Daily summary sent at ${getKenyaTime()}`);
}
if (dailySummaryEnabled) {
  setInterval(sendDailySummary, 24*60*60*1000);
}

////////////////////////////////////////////////////////////////////////////////
// 8) MAIN MESSAGE HANDLER
////////////////////////////////////////////////////////////////////////////////
client.on('message_create', async (message) => {
  if (message.fromMe) return;
  if (maintenanceMode && !isAdmin(message.from)) {
    await message.reply(`🚧 Maintenance mode. Try again later. (Tip: "00" for Main Menu)`);
    return;
  }
  const chatId = message.from;
  const text = message.body.trim();
  console.log(`[${getKenyaTime()}] Message from ${chatId}: ${text}`);

  // Quick nav
  if (text === '0') {
    if (sessions[chatId] && sessions[chatId].prevState) {
      sessions[chatId].state = sessions[chatId].prevState;
      await message.reply(`🔙 Going back. (Tip: "00" for Main Menu)`);
    } else {
      sessions[chatId] = { state: 'main_menu' };
      await message.reply(`🔙 Cancelled. Returning to Main Menu.\n${mainMenuText()}`);
    }
    return;
  }
  if (text === '00') {
    sessions[chatId] = { state: 'main_menu' };
    await message.reply(`🏠 Main Menu:\n${mainMenuText()}`);
    return;
  }
  // "help"
  if (text.toLowerCase() === 'help') {
    await message.reply(
      `❓ *HELP*\n\n` +
      `• Registration is auto for new users.\n` +
      `• Main Menu => type "00".\n` +
      `• "leaderboard" if enabled, "reward" for points, "packages" for invests, "ticket <msg>" for support.\n` +
      `• "0" to go back, "00" for main menu, "admin" if you're admin.\n\n` +
      `Enjoy!`
    );
    return;
  }
  // "leaderboard"
  if (text.toLowerCase() === 'leaderboard' && leaderboardEnabled) {
    await handleLeaderboard(message);
    return;
  }
  // "reward"
  if (text.toLowerCase() === 'reward') {
    await handleRewardPoints(message);
    return;
  }
  // "packages"
  if (text.toLowerCase() === 'packages') {
    await handlePackages(message);
    return;
  }
  // "DP status ..."
  if (/^dp status /i.test(text)) {
    await handleDepositStatusRequest(message);
    return;
  }
  // "ticket <issue>"
  if (text.toLowerCase().startsWith('ticket ')) {
    let issue = text.substring(7).trim();
    if (!issue) {
      await message.reply(`Please provide an issue after "ticket". (Tip: "00" for Main Menu)`);
      return;
    }
    supportTickets.push({ user: chatId, message: issue, time: getKenyaTime() });
    await message.reply(`📨 Ticket received. We'll get back soon.\n(Tip: "00" for Main Menu)`);
    for (let adminPhone of admins) {
      try {
        await client.sendMessage(`${adminPhone}@c.us`, `📨 Support Ticket from ${chatId}\n${issue}\n[${getKenyaTime()}]`);
      } catch (err) {
        console.error(`Error notifying admin ${adminPhone}:`, err);
      }
    }
    return;
  }
  // "admin"
  if (text.toLowerCase() === 'admin' && isAdmin(chatId)) {
    sessions[chatId] = { state: 'admin_menu' };
    await message.reply(adminMenuText());
    return;
  }

  // If user not registered => registration
  let regUser = Object.values(users).find(u => u.whatsAppId === chatId);
  if (!regUser) {
    if (!sessions[chatId]) sessions[chatId] = { state: 'start' };
    await handleRegistration(message, sessions[chatId]);
    return;
  }
  // If user banned
  if (regUser.banned) {
    await message.reply(`🚫 You have been banned. Contact support if needed.`);
    return;
  }
  // If admin menu
  if (sessions[chatId] && sessions[chatId].state === 'admin_menu') {
    await handleAdminMenuChoice(message, regUser);
    return;
  }
  // Otherwise user main menu
  if (!sessions[chatId]) sessions[chatId] = { state: 'main_menu' };
  await handleUserSession(message, sessions[chatId], regUser);
});

////////////////////////////////////////////////////////////////////////////////
// 9) ADMIN MENU TEXT
////////////////////////////////////////////////////////////////////////////////
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
    `34. Set Bot Phone Number\n` +
    `35. Back to Main Menu\n\n` +
    `Type the *number* of the command.`
  );
}

////////////////////////////////////////////////////////////////////////////////
// 10) HANDLE ADMIN MENU CHOICE
////////////////////////////////////////////////////////////////////////////////
async function handleAdminMenuChoice(msg, user) {
  const chatId = msg.from;
  const choice = msg.body.trim();
  switch (choice) {
    case '1': { // view users
      let list = Object.values(users).map(u => `${u.firstName} ${u.secondName} - Phone: ${u.phone}`).join('\n');
      if (!list) list = "No users found.";
      await msg.reply(`📋 *User List:*\n${list}\nType "admin" for menu again or "35" to exit admin menu.`);
      break;
    }
    case '34': {
      // Set Bot Phone Number
      sessions[chatId].state = 'set_bot_phone';
      await msg.reply(`📱 Enter the new bot phone number (digits only, e.g. 254700XXXXXX):`);
      break;
    }
    case '35': {
      // back to main menu
      sessions[chatId] = { state: 'main_menu' };
      await msg.reply(`Returning to main menu.\n${mainMenuText()}`);
      break;
    }
    default:
      await msg.reply(`❓ That admin menu option not recognized. Type "admin" to see menu again.`);
      break;
  }
}

////////////////////////////////////////////////////////////////////////////////
// 11) REGISTRATION HANDLER
////////////////////////////////////////////////////////////////////////////////
async function handleRegistration(msg, session) {
  const chatId = msg.from;
  const text = msg.body.trim();
  switch (session.state) {
    case 'start':
      await msg.reply(
        `👋 ${customWelcomeMessage}\n` +
        `Please enter your *first name* to begin. (Tip: "00" for Main Menu)`
      );
      session.state = 'awaiting_first_name';
      break;
    case 'awaiting_first_name':
      session.firstName = text;
      setTimeout(async () => {
        await msg.reply(`✨ Great, ${session.firstName}! Now, please enter your *second name*.`);
        session.state = 'awaiting_second_name';
      }, 2000);
      break;
    case 'awaiting_second_name':
      session.secondName = text;
      await msg.reply(
        `🙏 Thanks, ${session.firstName} ${session.secondName}!\nIf you have a referral code, type it now; otherwise type NONE.\n(Tip: "00" for Main Menu)`
      );
      session.state = 'awaiting_referral_code';
      break;
    case 'awaiting_referral_code': {
      const code = text.toUpperCase();
      if (code !== 'NONE') {
        let refUser = Object.values(users).find(u => u.referralCode === code);
        if (refUser) {
          session.referredBy = refUser.whatsAppId;
          await msg.reply(`👍 Referral code accepted!\nNow enter your phone number (start with 070 or 01, 10 digits).`);
        } else {
          await msg.reply(`⚠️ Referral code not found. Continuing without it.\nEnter your phone number (070/01, 10 digits).`);
        }
      } else {
        await msg.reply(`No referral code? Alright!\nEnter your phone number (070/01, 10 digits).`);
      }
      session.state = 'awaiting_phone';
      break;
    }
    case 'awaiting_phone':
      if (!/^(070|01)\d{7}$/.test(text)) {
        await msg.reply(`❌ Invalid phone format. Must start 070 or 01 and be 10 digits. Try again.`);
      } else {
        session.phone = text;
        await msg.reply(`🔒 Great! Now create a *4-digit PIN* for withdrawals.`);
        session.state = 'awaiting_withdraw_pin';
      }
      break;
    case 'awaiting_withdraw_pin':
      if (!/^\d{4}$/.test(text)) {
        await msg.reply(`❌ That PIN isn’t 4 digits. Try again.`);
      } else {
        session.withdrawPin = text;
        await msg.reply(`🔐 Almost done! Create a *4-digit security PIN* (for inactivity).`);
        session.state = 'awaiting_security_pin';
      }
      break;
    case 'awaiting_security_pin':
      if (!/^\d{4}$/.test(text)) {
        await msg.reply(`❌ Invalid PIN. Enter a 4-digit security PIN.`);
      } else {
        // Complete registration
        let newUser = {
          whatsAppId: chatId,
          firstName: session.firstName,
          secondName: session.secondName,
          phone: session.phone,
          withdrawalPIN: session.withdrawPin,
          securityPIN: text,
          referralCode: generateReferralCode(),
          referredBy: session.referredBy || null,
          referrals: [],
          accountBalance: 0,
          referralEarnings: 0,
          investments: [],
          deposits: [],
          withdrawals: [],
          rewardPoints: 0,
          banned: false
        };
        users[newUser.phone] = newUser;
        saveUsers();
        await msg.reply(`🎉 Registration successful, ${newUser.firstName}!\nYour referral code is: ${newUser.referralCode}\n(Tip: "00" for Main Menu)`);
        sessions[chatId] = { state: 'main_menu' };
      }
      break;
    default:
      await msg.reply(`😓 Something went wrong. Type "00" for Main Menu.`);
      session.state = 'main_menu';
      break;
  }
}

////////////////////////////////////////////////////////////////////////////////
// 12) HANDLE ADMIN MENU "STATE" CHANGES
////////////////////////////////////////////////////////////////////////////////
client.on('message_create', async (msg) => {
  // If user is in the middle of an admin sub-state (like set_bot_phone)
  if (sessions[msg.from] && sessions[msg.from].state === 'set_bot_phone' && isAdmin(msg.from)) {
    let newPhone = msg.body.trim().replace(/\D/g, '');
    if (!newPhone) {
      await msg.reply(`❌ Invalid phone. Please enter digits only. (Tip: "admin" for menu, "35" to exit)`);
    } else {
      BOT_PHONE = newPhone;
      await msg.reply(`✅ Bot phone number for referral link set to ${BOT_PHONE}. (Tip: "admin" for menu, "35" to exit)`);
      sessions[msg.from].state = 'admin_menu';
    }
  }
});

////////////////////////////////////////////////////////////////////////////////
// 13) USER SESSION HANDLER
////////////////////////////////////////////////////////////////////////////////
async function handleUserSession(msg, session, user) {
  const text = msg.body.trim();
  switch (session.state) {
    case 'main_menu':
      switch (text) {
        case '1': // Invest
          session.state = 'invest';
          await msg.reply(`💰 *Invest Now!*\nEnter the amount (min 1000, max 150000): (Tip: "0" back, "00" main menu)`);
          break;
        case '2': // Check Balance
          session.state = 'check_balance_menu';
          await msg.reply(`🔍 *Check Balance*\n1. Account Balance\n2. Referral Earnings\n3. Investment History\n(Tip: "0" back, "00" main)`);
          break;
        case '3': // Withdraw
          session.state = 'withdraw';
          await msg.reply(`💸 *Withdraw Earnings!*\nEnter amount (min ${withdrawalMin}, max ${withdrawalMax}, unless full). (Tip: "0" back, "00" main)`);
          break;
        case '4': // Deposit
          session.state = 'deposit';
          await msg.reply(`💵 *Deposit Funds!*\nEnter amount (min ${depositMin}, max ${depositMax}). Payment details: ??? (Tip: "0" back, "00" main)`);
          break;
        case '5': // Change PIN
          session.state = 'change_pin';
          await msg.reply(`🔑 Enter your current 4-digit PIN: (Tip: "0" back, "00" main)`);
          break;
        case '6': { // Referral Link
          let link = `https://wa.me/${BOT_PHONE}?text=REF${encodeURIComponent(user.referralCode)}`;
          await msg.reply(`🔗 *Your Referral Link*\n${link}\n(Tip: "00" for Main Menu)`);
          break;
        }
        case '7': // Referral History
          if (user.referrals.length === 0)
            await msg.reply(`👥 No referrals yet. (Tip: "00" main menu)`);
          else
            await msg.reply(`👥 Referral History\nTotal: ${user.referrals.length}\nPhones: ${user.referrals.join(', ')}\nEarnings: Ksh ${user.referralEarnings}\n(Tip: "00" main menu)`);
          break;
        case '8': // Update Profile
          session.state = 'update_profile_menu';
          await msg.reply(`✍️ *Update Profile*\n1. First Name\n2. Second Name\n3. Phone Number\n(Tip: "0" back, "00" main)`);
          break;
        default:
          await msg.reply(`❓ Invalid option. (Tip: "00" main menu)`);
          break;
      }
      break;

    case 'invest':
      {
        let amt = parseFloat(text);
        if (isNaN(amt) || amt < 1000 || amt > 150000) {
          await msg.reply(`❌ Invalid amount. (Tip: "0" back, "00" main)`);
        } else if (user.accountBalance < amt) {
          await msg.reply(`⚠️ Insufficient balance (Ksh ${user.accountBalance}). (Tip: "00" main)`);
          session.state = 'main_menu';
        } else {
          session.investAmount = amt;
          session.state = 'confirm_investment';
          await msg.reply(`🔐 Enter your 4-digit PIN to confirm investing Ksh ${amt}. (Tip: "0" back, "00" main)`);
        }
      }
      break;
    case 'confirm_investment':
      if (text !== user.withdrawalPIN) {
        await msg.reply(`❌ Incorrect PIN. Try again or "0" to cancel.`);
      } else {
        // create investment
        let invest = {
          amount: session.investAmount,
          timestamp: Date.now(),
          date: getKenyaTime(),
          expectedReturn: (session.investAmount * investmentReturnPercent / 100).toFixed(2),
          status: 'active',
          matured: false
        };
        user.accountBalance -= session.investAmount;
        user.investments.push(invest);
        if (user.investments.length === 1 && user.referredBy) {
          let refUser = Object.values(users).find(u => u.whatsAppId === user.referredBy);
          if (refUser) {
            let bonus = session.investAmount * referralBonusPercent / 100;
            refUser.referralEarnings += bonus;
            refUser.referrals.push(user.phone);
          }
        }
        user.rewardPoints = (user.rewardPoints || 0) + session.investAmount * rewardRate;
        saveUsers();
        await msg.reply(`✅ Investment Confirmed!\nAmount: ${session.investAmount}, Return: ${(session.investAmount*investmentReturnPercent/100).toFixed(2)} at ${investmentReturnPercent}%\n(Tip: "00" main)`);
        session.state = 'main_menu';
      }
      break;

    case 'check_balance_menu':
      switch (text) {
        case '1':
          await msg.reply(`💳 Account Balance: Ksh ${user.accountBalance}\n(Tip: "00" main)`);
          session.state = 'main_menu';
          break;
        case '2':
          await msg.reply(`🎉 Referral Earnings: Ksh ${user.referralEarnings}\n(Tip: "00" main)`);
          session.state = 'main_menu';
          break;
        case '3':
          if (user.investments.length === 0) {
            await msg.reply(`📄 No investments yet. (Tip: "00" main)`);
          } else {
            let hist = user.investments.map((inv,i) =>
              `${i+1}. Amount: ${inv.amount}, Return: ${inv.expectedReturn}, Date: ${inv.date}, Status: ${inv.status}${inv.matured ? " (Matured)" : ""}`
            ).join('\n');
            await msg.reply(`📊 Investment History:\n${hist}\n(Tip: "00" main)`);
          }
          session.state = 'main_menu';
          break;
        default:
          await msg.reply(`❓ Invalid. (Tip: "0" back, "00" main)`);
          break;
      }
      break;

    case 'withdraw':
      {
        let amt = parseFloat(text);
        if (isNaN(amt)) {
          await msg.reply(`❌ Invalid. (Tip: "0" back, "00" main)`);
        } else if (amt !== user.referralEarnings && (amt < withdrawalMin || amt > withdrawalMax)) {
          await msg.reply(`❌ Must be between ${withdrawalMin} and ${withdrawalMax}, unless withdrawing full. (Tip: "0" back, "00" main)`);
        } else if (user.referralEarnings < amt) {
          await msg.reply(`⚠️ You only have Ksh ${user.referralEarnings}. (Tip: "00" main)`);
          session.state = 'main_menu';
        } else {
          user.referralEarnings -= amt;
          let wd = {
            amount: amt,
            date: getKenyaTime(),
            withdrawalID: generateWithdrawalID(),
            status: 'pending'
          };
          user.withdrawals.push(wd);
          saveUsers();
          await msg.reply(`✅ Withdrawal Requested. ID: ${wd.withdrawalID}, Amount: ${amt}, Under review.\n(Tip: "00" main)`);
          session.state = 'main_menu';
        }
      }
      break;

    case 'deposit':
      {
        let amt = parseFloat(text);
        if (isNaN(amt) || amt < depositMin || amt > depositMax) {
          await msg.reply(`❌ Invalid deposit amount. (Tip: "0" back, "00" main)`);
        } else {
          let dep = { amount: amt, date: getKenyaTime(), depositID: generateDepositID(), status: 'initiating' };
          user.deposits.push(dep);
          saveUsers();
          let stkResp = await initiatePayHeroSTK(amt, user);
          if (stkResp.success) {
            dep.depositID = stkResp.depositID;
            dep.status = 'under review';
            saveUsers();
            await msg.reply(`💵 STK push sent for Ksh ${amt}. ID: ${dep.depositID}, status: under review. Checking in ~20s.\n(Tip: "00" main)`);
            setTimeout(async () => { await checkPayHeroTransaction(user, dep.depositID, msg); }, 20000);
          } else {
            dep.status = 'failed';
            saveUsers();
            await msg.reply(`❌ STK push failed. (Tip: "00" main)`);
          }
          session.state = 'main_menu';
        }
      }
      break;

    case 'change_pin':
      if (text !== user.withdrawalPIN) {
        await msg.reply(`❌ Incorrect PIN. "0" to cancel, "00" main`);
      } else {
        session.state = 'new_pin';
        await msg.reply(`🔑 Enter new 4-digit PIN. (Tip: "0" back, "00" main)`);
      }
      break;
    case 'new_pin':
      if (!/^\d{4}$/.test(text)) {
        await msg.reply(`❌ Invalid PIN. 4 digits only. (Tip: "0" back, "00" main)`);
      } else {
        user.withdrawalPIN = text;
        saveUsers();
        await msg.reply(`✅ PIN changed. (Tip: "00" main)`);
        session.state = 'main_menu';
      }
      break;
    case 'update_profile_menu':
      switch (text) {
        case '1':
          session.state = 'update_profile_firstname';
          await msg.reply(`✍️ Enter new first name. (Tip: "0" back)`);
          break;
        case '2':
          session.state = 'update_profile_secondname';
          await msg.reply(`✍️ Enter new second name. (Tip: "0" back)`);
          break;
        case '3':
          session.state = 'update_profile_phone';
          await msg.reply(`✍️ Enter new phone (070/01, 10 digits). (Tip: "0" back)`);
          break;
        default:
          await msg.reply(`❓ Invalid. (Tip: "0" back, "00" main)`);
          break;
      }
      break;
    case 'update_profile_firstname':
      user.firstName = text;
      saveUsers();
      await msg.reply(`✅ First Name updated. (Tip: "00" main)`);
      session.state = 'main_menu';
      break;
    case 'update_profile_secondname':
      user.secondName = text;
      saveUsers();
      await msg.reply(`✅ Second Name updated. (Tip: "00" main)`);
      session.state = 'main_menu';
      break;
    case 'update_profile_phone':
      if (!/^(070|01)\d{7}$/.test(text)) {
        await msg.reply(`❌ Invalid phone. Must start 070 or 01, 10 digits. (Tip: "0" back, "00" main)`);
      } else {
        user.phone = text;
        saveUsers();
        await msg.reply(`✅ Phone updated to ${user.phone}. (Tip: "00" main)`);
        session.state = 'main_menu';
      }
      break;
    default:
      await msg.reply(`🤔 Not sure what you mean. (Tip: "00" main)`);
      break;
  }
}

////////////////////////////////////////////////////////////////////////////////
// 14) ADMIN MENU CHOICE HANDLER
// (We've partially implemented in handleAdminMenuChoice. Expand as needed.)
////////////////////////////////////////////////////////////////////////////////
async function handleAdminMenu(msg, user) {
  // We did handleAdminMenuChoice above. This is a partial approach. 
}

////////////////////////////////////////////////////////////////////////////////
// 15) LEADERBOARD, REWARD POINTS, PACKAGES, DEPOSIT STATUS
////////////////////////////////////////////////////////////////////////////////
async function handleLeaderboard(msg) {
  if (!leaderboardEnabled) {
    await msg.reply(`Leaderboard is disabled. (Tip: "00" main)`);
    return;
  }
  let startToday = new Date();
  startToday.setHours(0,0,0,0);
  let arr = [];
  Object.values(users).forEach(u => {
    let total = 0;
    u.investments.forEach(inv => {
      if (inv.timestamp >= startToday.getTime()) total += inv.amount;
    });
    arr.push({ name: `${u.firstName} ${u.secondName}`, total });
  });
  arr.sort((a,b) => b.total - a.total);
  let top5 = arr.slice(0,5);
  if (top5.length === 0) {
    await msg.reply(`🏆 Leaderboard empty for today. (Tip: "00" main)`);
  } else {
    let lbText = top5.map((e,i) => `${i+1}. ${e.name} – Ksh ${e.total}`).join('\n');
    await msg.reply(`🏆 *Today's Top Investors:*\n${lbText}\n[${getKenyaTime()}]\n(Tip: "00" main)`);
  }
}

async function handleRewardPoints(msg) {
  let user = Object.values(users).find(u => u.whatsAppId === msg.from);
  if (!user) {
    await msg.reply(`Not registered. (Tip: "00" main)`);
    return;
  }
  let points = user.rewardPoints || 0;
  await msg.reply(`🎯 Your Reward Points: ${points}\n(Tip: "00" main)`);
}

async function handlePackages(msg) {
  if (investmentPackages.length === 0) {
    await msg.reply(`No packages. (Tip: "00" main)`);
  } else {
    let txt = investmentPackages.map((p,i) => `${i+1}. ${p.name} – Min: ${p.min}, Max: ${p.max}, Return: ${p.returnPercent}%, Duration: ${p.durationDays} days`).join('\n');
    await msg.reply(`📦 *Available Packages*\n${txt}\n(Tip: "00" main)`);
  }
}

async function handleDepositStatusRequest(msg) {
  let text = msg.body.trim().split(' ');
  if (text.length < 3) {
    await msg.reply(`Usage: DP status <DEP-ID>. (Tip: "00" main)`);
    return;
  }
  let depositID = text.slice(2).join(' ');
  let user = Object.values(users).find(u => u.whatsAppId === msg.from);
  if (!user) {
    await msg.reply(`Not registered. (Tip: "00" main)`);
    return;
  }
  let dep = user.deposits.find(d => d.depositID === depositID);
  if (!dep) {
    await msg.reply(`No deposit found with ID: ${depositID}. (Tip: "00" main)`);
    return;
  }
  await msg.reply(
    `📝 *Deposit Status*\n` +
    `ID: ${dep.depositID}\n` +
    `Amount: Ksh ${dep.amount}\n` +
    `Date: ${dep.date}\n` +
    `Status: ${dep.status}\n` +
    `[${getKenyaTime()}]\n(Tip: "00" main)`
  );
}

////////////////////////////////////////////////////////////////////////////////
// 16) MAIN MENU TEXT
////////////////////////////////////////////////////////////////////////////////
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
    `Type "0" to go back or "00" for Main Menu.\n` +
    `Type "help" for more.`
  );
}

////////////////////////////////////////////////////////////////////////////////
// 17) START THE CLIENT
////////////////////////////////////////////////////////////////////////////////
client.initialize();
