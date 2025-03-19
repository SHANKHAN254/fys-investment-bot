/**
 * FY'S INVESTMENT BOT – SUPERCHARGED VERSION 🚀
 *
 * FEATURES:
 *  • Displays a QR code on an Express webpage (http://localhost:3000)
 *  • Engaging, emoji-filled responses with clear navigation:
 *       - "0" (🔙) goes back to the previous activity.
 *       - "00" (🏠) returns to the Main Menu.
 *  • Users can: Invest, Check Balance, Withdraw, Deposit, Change PIN,
 *       get Referral Link, view Referral History, Update Profile, view Reward Points, and see Investment Packages.
 *  • Admins can: Manage users (ban/unban, add/deduct balance),
 *       set deposit/withdrawal limits, update deposit info, change investment return %, 
 *       set dynamic referral bonus %, send broadcast reminders, toggle maintenance and leaderboard features,
 *       adjust reward rate, add/deduct reward points, add/view custom investment packages,
 *       mature or cancel investments, and more.
 *  • NEW EXTRA FEATURE: Automatic deposit confirmation via an external API integration.
 *       The bot polls a (dummy) API endpoint for each deposit with status "under review" every 60 seconds.
 *       If the API returns a "confirmed" status, the deposit is updated and the user's balance is credited automatically.
 *
 * SETTINGS:
 *  • BOT_PHONE: The bot’s WhatsApp number (digits only, e.g., "254700363422")
 *  • SUPER_ADMIN: Fixed at "254701339573"
 *
 * (Replace the dummy API URL below with your actual deposit status API endpoint.)
 */

const { Client } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const express = require('express');
const qrcode = require('qrcode');
const axios = require('axios');  // For API integration

// ---------------------------
// CONFIG & GLOBAL VARIABLES
// ---------------------------
const BOT_PHONE = '254700363422';
const SUPER_ADMIN = '254701339573';
let admins = [SUPER_ADMIN];

// Global limits (modifiable via admin commands)
let withdrawalMin = 1000;
let withdrawalMax = 10000000;  // Set high to allow full withdrawal
let depositMin = 1;
let depositMax = 10000000;

// Extra feature globals:
let referralBonusPercent = 3; // % bonus on first investment from referral
let customWelcomeMessage = "👋 Welcome to FY'S INVESTMENT BOT! Start your journey to smart investing!";
let maintenanceMode = false;
let leaderboardEnabled = false;
let rewardRate = 1; // Reward points per Ksh invested
let investmentPackages = []; // e.g., { name, min, max, returnPercent, durationDays }

// Deposit payment details (modifiable via admin)
let depositInfo = { number: "0701339573", name: "Camlus Okoth" };

// Dummy API endpoint for deposit status checking (replace with your real endpoint)
const DEPOSIT_STATUS_API = "https://api.example.com/depositstatus";

// User data file and session storage
const USERS_FILE = path.join(__dirname, 'users.json');
let sessions = {};
let users = {};
if (fs.existsSync(USERS_FILE)) {
  try { users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch (e) { console.error('Error reading users file:', e); users = {}; }
} else { users = {}; }
function saveUsers() { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); }

// Helper: get Kenya time as a string
function getKenyaTime() {
  return new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' });
}

// Helper: random string generator for codes
function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i=0; i<length; i++) { result += chars.charAt(Math.floor(Math.random()*chars.length)); }
  return result;
}
function generateReferralCode() { return "FY'S-" + randomString(5); }
function generateDepositID() { return "DEP-" + randomString(8); }
function generateWithdrawalID() { return "WD-" + randomString(4); }

// Navigation helper: update session state and store previous state
function updateState(session, newState) {
  session.prevState = session.state;
  session.state = newState;
}

// ---------------------------
// EXPRESS SERVER FOR QR CODE
// ---------------------------
const app = express();
let lastQr = null;
app.get('/', (req, res) => {
  if (!lastQr) {
    return res.send(`
      <html>
        <body style="font-family: sans-serif; text-align: center; margin-top: 50px;">
          <h1>FY'S INVESTMENT BOT</h1>
          <p>😅 No QR code available yet. Please wait...</p>
        </body>
      </html>
    `);
  }
  qrcode.toDataURL(lastQr, (err, url) => {
    if (err) return res.send('Error generating QR code.');
    res.send(`
      <html>
        <body style="font-family: sans-serif; text-align: center; margin-top: 50px;">
          <h1>FY'S INVESTMENT BOT - QR Code</h1>
          <img src="${url}" alt="WhatsApp QR Code"/>
          <p>📱 Scan this code with WhatsApp to log in!</p>
        </body>
      </html>
    `);
  });
});
app.listen(3000, () => { console.log('🚀 Express server running at http://localhost:3000'); });

// ---------------------------
// WHATSAPP CLIENT SETUP
// ---------------------------
const client = new Client();
client.on('qr', (qr) => { console.log('🔄 New QR code generated. Open http://localhost:3000 to view it.'); lastQr = qr; });
client.on('ready', async () => {
  console.log(`✅ Client is ready! [${getKenyaTime()}]`);
  const superAdminWID = `${SUPER_ADMIN}@c.us`;
  try {
    await client.sendMessage(superAdminWID, `🎉 Hello Super Admin! FY'S INVESTMENT BOT is now online! [${getKenyaTime()}]`);
  } catch (error) { console.error('Error sending message to Super Admin:', error); }
});

// ---------------------------
// POLL PENDING DEPOSITS VIA API
// ---------------------------
// This function checks all pending deposits ("under review") and calls the external API.
// If a deposit is confirmed, its status is updated and the deposit amount is credited automatically.
async function pollPendingDeposits() {
  for (const phone in users) {
    let user = users[phone];
    for (let dep of user.deposits) {
      if (dep.status === 'under review') {
        try {
          const response = await axios.get(`${DEPOSIT_STATUS_API}?depositId=${dep.depositID}`);
          // Assume the API returns JSON with a field "status" which is "confirmed" or "rejected"
          if (response.data.status === 'confirmed') {
            dep.status = 'confirmed';
            user.accountBalance += parseFloat(dep.amount);
            console.log(`Deposit ${dep.depositID} confirmed via API. Added Ksh ${dep.amount} to ${user.phone}`);
          } else if (response.data.status === 'rejected') {
            dep.status = 'rejected';
          }
        } catch (err) {
          console.error(`Error checking deposit ${dep.depositID}:`, err.message);
        }
      }
    }
  }
  saveUsers();
}
// Poll every 60 seconds.
setInterval(pollPendingDeposits, 60000);

// ---------------------------
// MAIN MESSAGE HANDLER
// ---------------------------
client.on('message_create', async (message) => {
  // If maintenance mode is enabled (for non-admins), show maintenance message.
  if (maintenanceMode && !isAdmin(message.from)) {
    await message.reply(`🚧 FY'S INVESTMENT BOT is under maintenance. Please try again later. (Tip: "00" for Main Menu)`);
    return;
  }
  if (message.fromMe) return; // Ignore bot’s own messages

  const chatId = message.from;
  const msgBody = message.body.trim();
  console.log(`[${getKenyaTime()}] Message from ${chatId}: ${msgBody}`);

  // Navigation shortcuts:
  if (msgBody === '0') {
    if (sessions[chatId] && sessions[chatId].prevState) {
      sessions[chatId].state = sessions[chatId].prevState;
      await message.reply(`🔙 Going back to your previous activity. (Tip: "00" for Main Menu)`);
    } else {
      sessions[chatId].state = 'awaiting_menu_selection';
      await message.reply(`🔙 Operation cancelled. Returning to Main Menu...\n\n${mainMenuText()}`);
    }
    return;
  }
  if (msgBody === '00') {
    sessions[chatId] = { state: 'awaiting_menu_selection' };
    await message.reply(`🏠 Main Menu:\n\n${mainMenuText()}`);
    return;
  }
  if (msgBody.toLowerCase() === 'help') {
    await message.reply(
      `❓ *HELP / FAQ*\n\n` +
      `• Registration: Follow the prompts when you first message the bot.\n` +
      `• Main Menu Options: Invest 💰, Check Balance 🔍, Withdraw 💸, Deposit 💵, Change PIN 🔐, Referral Link 🔗, Referral History 👥, Update Profile ✍️, Reward Points 🎯, and Packages 📦.\n` +
      `• Navigation: Type "0" to go back, "00" to return to Main Menu.\n` +
      `• Additional Commands: "leaderboard" (if enabled) shows today's top investors, "reward" shows your reward points, and "packages" shows available investment packages.\n\n` +
      `Enjoy and invest smartly! 🚀`
    );
    return;
  }
  if (msgBody.toLowerCase() === 'leaderboard' && leaderboardEnabled) {
    // Calculate leaderboard (top 5 users by today's investment total)
    const startOfToday = new Date(); startOfToday.setHours(0,0,0,0);
    let leaderboard = [];
    Object.values(users).forEach(u => {
      let total = 0;
      u.investments.forEach(inv => { if (inv.timestamp >= startOfToday.getTime()) total += inv.amount; });
      leaderboard.push({ name: `${u.firstName} ${u.secondName}`, total });
    });
    leaderboard.sort((a, b) => b.total - a.total);
    leaderboard = leaderboard.slice(0, 5);
    if (leaderboard.length === 0)
      await message.reply(`🏆 Leaderboard is empty for today. Be the first to invest!`);
    else {
      let lbText = leaderboard.map((entry, i) => `${i+1}. ${entry.name} – Ksh ${entry.total}`).join('\n');
      await message.reply(`🏆 *Today's Top Investors:*\n${lbText}\n[${getKenyaTime()}]`);
    }
    return;
  }
  if (msgBody.toLowerCase() === 'reward') {
    let regUser = Object.values(users).find(u => u.whatsAppId === chatId);
    if (regUser)
      await message.reply(`🎯 *Your Reward Points:* ${regUser.rewardPoints || 0}\n(Tip: "00" for Main Menu)`);
    else
      await message.reply(`You are not registered yet. Please register first!`);
    return;
  }
  if (msgBody.toLowerCase() === 'packages') {
    if (investmentPackages.length === 0)
      await message.reply(`📦 No investment packages available at the moment.\n(Tip: "00" for Main Menu)`);
    else {
      let pkgText = investmentPackages.map((p, i) =>
        `${i+1}. ${p.name} – Min: Ksh ${p.min}, Max: Ksh ${p.max}, Return: ${p.returnPercent}%, Duration: ${p.durationDays} days`
      ).join('\n');
      await message.reply(`📦 *Available Investment Packages:*\n${pkgText}\n(Tip: "00" for Main Menu)`);
    }
    return;
  }
  // Admin commands
  if (msgBody.toLowerCase().startsWith('admin') && isAdmin(chatId)) {
    await processAdminCommand(message);
    return;
  }
  // Deposit status check: "DP status <DEP-ID>"
  if (/^dp status /i.test(msgBody)) {
    await handleDepositStatusRequest(message);
    return;
  }
  // Check registration
  let regUser = Object.values(users).find(u => u.whatsAppId === chatId);
  if (!sessions[chatId]) { sessions[chatId] = { state: regUser ? 'awaiting_menu_selection' : 'start' }; }
  let session = sessions[chatId];
  if (!regUser) { await handleRegistration(message, session); }
  else {
    if (regUser.banned) { await message.reply(`🚫 You have been banned from this service. Please contact support.`); return; }
    await handleUserSession(message, session, regUser);
  }
});

// ---------------------------
// DEPOSIT STATUS HANDLER
// ---------------------------
async function handleDepositStatusRequest(message) {
  const parts = message.body.trim().split(' ');
  if (parts.length < 3) {
    await message.reply(`❓ Please specify the deposit ID. E.g.: "DP status DEP-ABCDEFGH"\n(Tip: "0" to go back, "00" for Main Menu)`);
    return;
  }
  const depositID = parts.slice(2).join(' ');
  let regUser = Object.values(users).find(u => u.whatsAppId === message.from);
  if (!regUser) { await message.reply(`😕 You are not registered yet. Please register first!`); return; }
  let dep = regUser.deposits.find(d => d.depositID.toLowerCase() === depositID.toLowerCase());
  if (!dep) { await message.reply(`❌ No deposit found with ID: ${depositID}\nPlease check and try again.`); return; }
  await message.reply(`📝 *Deposit Status:*\n• ID: ${dep.depositID}\n• Amount: Ksh ${dep.amount}\n• Date: ${dep.date}\n• Status: ${dep.status}\n\n[${getKenyaTime()}]\n(Tip: "00" for Main Menu)`);
}

// ---------------------------
// REGISTRATION HANDLER
// ---------------------------
async function handleRegistration(message, session) {
  const msgBody = message.body.trim();
  switch (session.state) {
    case 'start':
      await message.reply(`👋 ${customWelcomeMessage}\nPlease type your *first name* to begin.\n(Tip: "00" for Main Menu)`);
      session.state = 'awaiting_first_name';
      break;
    case 'awaiting_first_name':
      session.firstName = msgBody;
      setTimeout(async () => {
        await message.reply(`✨ Great, ${session.firstName}! Now type your *second name*.`);
        updateState(session, 'awaiting_second_name');
      }, 2000);
      break;
    case 'awaiting_second_name':
      session.secondName = msgBody;
      await message.reply(`🙏 Thanks, ${session.firstName} ${session.secondName}!\nIf you have a *referral code*, type it now; otherwise type *NONE*.\n(Tip: "0" to go back, "00" for Main Menu)`);
      updateState(session, 'awaiting_referral_code');
      break;
    case 'awaiting_referral_code': {
      const code = msgBody.toUpperCase();
      if (code !== 'NONE') {
        let ref = Object.values(users).find(u => u.referralCode === code);
        if (ref) {
          session.referredBy = ref.whatsAppId;
          await message.reply(`👍 Referral code accepted!\nNow type your phone number (070/01, 10 digits).`);
        } else {
          await message.reply(`⚠️ Referral code not found. Proceeding without it.\nType your phone number (070/01, 10 digits).`);
        }
      } else {
        await message.reply(`No referral code entered.\nType your phone number (070/01, 10 digits).`);
      }
      updateState(session, 'awaiting_phone');
      break;
    }
    case 'awaiting_phone':
      if (!/^(070|01)\d{7}$/.test(msgBody)) {
        await message.reply(`❌ Invalid phone number! It must start with 070 or 01 and be 10 digits. Please re-enter.`);
      } else {
        session.phone = msgBody;
        await message.reply(`🔒 Awesome! Now create a *4-digit PIN* for withdrawals.`);
        updateState(session, 'awaiting_withdrawal_pin');
      }
      break;
    case 'awaiting_withdrawal_pin':
      if (!/^\d{4}$/.test(msgBody)) {
        await message.reply(`❌ That PIN isn’t 4 digits. Try a valid 4-digit PIN.`);
      } else {
        session.withdrawalPIN = msgBody;
        await message.reply(`🔐 Almost done! Now create a *4-digit security PIN* (for inactivity protection).`);
        updateState(session, 'awaiting_security_pin');
      }
      break;
    case 'awaiting_security_pin':
      if (!/^\d{4}$/.test(msgBody)) {
        await message.reply(`❌ Invalid PIN. Please enter a 4-digit security PIN.`);
      } else {
        session.securityPIN = msgBody;
        const newUser = {
          whatsAppId: message.from,
          firstName: session.firstName,
          secondName: session.secondName,
          phone: session.phone,
          withdrawalPIN: session.withdrawalPIN,
          securityPIN: session.securityPIN,
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
        users[session.phone] = newUser;
        saveUsers();
        await message.reply(`🎉 *Registration Successful!* Welcome, ${newUser.firstName}!\nYour referral code is: ${newUser.referralCode}\n[${getKenyaTime()}]\nType "00" for Main Menu 🏠.`);
        sessions[message.from] = { state: 'awaiting_menu_selection' };
      }
      break;
    default:
      await message.reply(`😓 Oops! Something went wrong. Type "00" for Main Menu.`);
      session.state = 'awaiting_menu_selection';
      break;
  }
}

// ---------------------------
// USER SESSION HANDLER
// ---------------------------
async function handleUserSession(message, session, user) {
  const msgBody = message.body.trim();
  switch (session.state) {
    case 'awaiting_menu_selection':
      // Main Menu Options (1: Invest, 2: Check Balance, 3: Withdraw, 4: Deposit,
      // 5: Change PIN, 6: Referral Link, 7: Referral History, 8: Update Profile)
      switch (msgBody) {
        case '1':
          updateState(session, 'invest');
          await message.reply(`💰 *Invest Now!*\nEnter investment amount (min Ksh 1,000; max Ksh 150,000):\n(Tip: "0" to go back, "00" for Main Menu)`);
          break;
        case '2':
          updateState(session, 'check_balance_menu');
          await message.reply(`🔍 *Check Balance:*\n1. Account Balance\n2. Referral Earnings\n3. Investment History\nReply with 1, 2, or 3.\n(Tip: "0" to go back, "00" for Main Menu)`);
          break;
        case '3':
          updateState(session, 'withdraw');
          await message.reply(`💸 *Withdraw Earnings:*\nEnter amount to withdraw (Min: Ksh ${withdrawalMin} unless full earnings, Max: Ksh ${withdrawalMax}):\n(Tip: "0" to go back, "00" for Main Menu)`);
          break;
        case '4':
          updateState(session, 'deposit');
          await message.reply(`💵 *Deposit Funds:*\nEnter deposit amount (Min: Ksh ${depositMin}; Max: Ksh ${depositMax}).\nPayment: ${depositInfo.number} (Name: ${depositInfo.name})\n(Tip: "0" to go back, "00" for Main Menu)`);
          break;
        case '5':
          updateState(session, 'change_pin');
          await message.reply(`🔑 *Change PIN:*\nEnter your current 4-digit PIN.\n(Tip: "0" to go back, "00" for Main Menu)`);
          break;
        case '6':
          {
            const referralLink = `https://wa.me/${BOT_PHONE}?text=REF${encodeURIComponent(user.referralCode)}`;
            await message.reply(`🔗 *Your Referral Link:*\n${referralLink}\nShare it with friends to earn rewards!\n[${getKenyaTime()}]\n(Tip: "00" for Main Menu)`);
            session.state = 'awaiting_menu_selection';
          }
          break;
        case '7':
          if (!user.referrals || user.referrals.length === 0)
            await message.reply(`👥 *Referral History:*\nNo referrals yet. Start sharing your link!\n(Tip: "00" for Main Menu)`);
          else
            await message.reply(`👥 *Referral History:*\nTotal: ${user.referrals.length}\nPhones: ${user.referrals.join(', ')}\nEarnings: Ksh ${user.referralEarnings}\n(Tip: "00" for Main Menu)`);
          session.state = 'awaiting_menu_selection';
          break;
        case '8':
          updateState(session, 'update_profile_menu');
          await message.reply(`✍️ *Update Profile:*\n1. First Name\n2. Second Name\n3. Phone Number\nReply with 1, 2, or 3.\n(Tip: "0" to go back, "00" for Main Menu)`);
          break;
        default:
          await message.reply(`❓ Option not recognized. Please enter a valid number.\n(Tip: "00" for Main Menu)`);
          break;
      }
      break;
    case 'invest': {
      let amt = parseFloat(msgBody);
      if (isNaN(amt) || amt < 1000 || amt > 150000)
        await message.reply(`❌ Enter an amount between Ksh 1,000 and Ksh 150,000.\n(Tip: "0" to go back, "00" for Main Menu)`);
      else if (user.accountBalance < amt)
        await message.reply(`⚠️ Insufficient funds! Your balance is Ksh ${user.accountBalance}.\nPlease deposit funds first.\n(Tip: "00" for Main Menu)`), session.state = 'awaiting_menu_selection';
      else {
        session.investAmount = amt;
        updateState(session, 'confirm_investment');
        await message.reply(`🔐 Enter your 4-digit PIN to confirm an investment of Ksh ${amt}.\n(Tip: "0" to go back, "00" for Main Menu)`);
      }
      break;
    }
    case 'confirm_investment':
      if (msgBody !== user.withdrawalPIN)
        await message.reply(`❌ Incorrect PIN! Try again or type "0" to cancel.`);
      else {
        let inv = {
          amount: session.investAmount,
          timestamp: Date.now(),
          date: getKenyaTime(),
          expectedReturn: (session.investAmount * investmentReturnPercent / 100).toFixed(2),
          status: 'active',
          matured: false
        };
        user.accountBalance -= session.investAmount;
        user.investments.push(inv);
        // Apply dynamic referral bonus on first investment
        if (user.investments.length === 1 && user.referredBy) {
          let referrer = Object.values(users).find(u => u.whatsAppId === user.referredBy);
          if (referrer) {
            let bonus = session.investAmount * referralBonusPercent / 100;
            referrer.referralEarnings += bonus;
            referrer.referrals.push(user.phone);
            console.log(`📢 [${getKenyaTime()}] Referral bonus: ${referrer.firstName} earned Ksh ${bonus.toFixed(2)} from ${user.firstName}'s investment.`);
          }
        }
        // Award reward points
        user.rewardPoints = (user.rewardPoints || 0) + session.investAmount * rewardRate;
        saveUsers();
        await message.reply(`✅ Investment Confirmed!\n• Amount: Ksh ${session.investAmount}\n• Expected Return: Ksh ${inv.expectedReturn} (at ${investmentReturnPercent}%)\n• Date: ${getKenyaTime()}\nYou earned ${session.investAmount * rewardRate} reward points!\nThank you for investing! 🎉\n(Tip: "00" for Main Menu)`);
        session.state = 'awaiting_menu_selection';
        await client.sendMessage(user.whatsAppId, `🎊 Investment Alert: You invested Ksh ${session.investAmount} on ${getKenyaTime()}.`);
        await notifyAdmins(`🔔 *Investment Alert!*\nUser: ${user.firstName} ${user.secondName} (${user.phone})\nInvested: Ksh ${session.investAmount}\n[${getKenyaTime()}]`);
      }
      break;
    case 'check_balance_menu':
      switch (msgBody) {
        case '1':
          await message.reply(`💳 Account Balance: Ksh ${user.accountBalance}\n[${getKenyaTime()}]\n(Tip: "00" for Main Menu)`), session.state = 'awaiting_menu_selection';
          break;
        case '2':
          await message.reply(`🎉 Referral Earnings: Ksh ${user.referralEarnings}\n[${getKenyaTime()}]\n(Tip: "00" for Main Menu)`), session.state = 'awaiting_menu_selection';
          break;
        case '3':
          if (user.investments.length === 0)
            await message.reply(`📄 No investments yet.\n[${getKenyaTime()}]\n(Tip: "00" for Main Menu)`);
          else {
            let hist = user.investments.map((inv, i) =>
              `${i+1}. Amount: Ksh ${inv.amount}, Return: Ksh ${inv.expectedReturn}, Date: ${inv.date}, Status: ${inv.status}${inv.matured ? " (Matured)" : ""}`
            ).join('\n');
            await message.reply(`📊 Investment History:\n${hist}\n[${getKenyaTime()}]\n(Tip: "00" for Main Menu)`);
          }
          session.state = 'awaiting_menu_selection';
          break;
        default:
          await message.reply(`❓ Reply with 1, 2, or 3.\n(Tip: "0" to go back, "00" for Main Menu)`);
          break;
      }
      break;
    case 'withdraw': {
      let amt = parseFloat(msgBody);
      if (isNaN(amt))
        await message.reply(`❌ Enter a valid withdrawal amount.\n(Tip: "0" to go back, "00" for Main Menu)`);
      else if (amt !== user.referralEarnings && (amt < withdrawalMin || amt > withdrawalMax))
        await message.reply(`❌ Withdrawal must be between Ksh ${withdrawalMin} and Ksh ${withdrawalMax} (unless withdrawing full earnings).\n(Tip: "0" to go back, "00" for Main Menu)`);
      else if (user.referralEarnings < amt)
        await message.reply(`⚠️ You only have Ksh ${user.referralEarnings} in referral earnings.\n(Tip: "00" for Main Menu)`), session.state = 'awaiting_menu_selection';
      else {
        user.referralEarnings -= amt;
        let wd = { amount: amt, date: getKenyaTime(), withdrawalID: generateWithdrawalID(), status: 'pending' };
        user.withdrawals.push(wd);
        saveUsers();
        await message.reply(`✅ Withdrawal Requested!\n• ID: ${wd.withdrawalID}\n• Amount: Ksh ${amt}\nStatus: Under review\n[${getKenyaTime()}]\n(Tip: "00" for Main Menu)`);
        session.state = 'awaiting_menu_selection';
        await notifyAdmins(`🔔 *Withdrawal Request!*\nUser: ${user.firstName} ${user.secondName} (${user.phone})\nAmount: Ksh ${amt}\nID: ${wd.withdrawalID}\n[${getKenyaTime()}]`);
      }
      break;
    }
    case 'deposit': {
      let amt = parseFloat(msgBody);
      if (isNaN(amt) || amt < depositMin || amt > depositMax)
        await message.reply(`❌ Deposit amount must be between Ksh ${depositMin} and Ksh ${depositMax}.\n(Tip: "0" to go back, "00" for Main Menu)`);
      else {
        let bonus = amt >= 100000 ? (amt * 1 / 100).toFixed(2) : 0;
        let dep = { amount: amt, date: getKenyaTime(), depositID: generateDepositID(), status: 'under review' };
        user.deposits.push(dep);
        saveUsers();
        let bonusMsg = bonus > 0 ? `\n🎁 Bonus: Ksh ${bonus}` : "";
        await message.reply(`💵 Deposit Request Received!\n• ID: ${dep.depositID}\n• Amount: Ksh ${amt}${bonusMsg}\nPay to: ${depositInfo.number} (Name: ${depositInfo.name})\nStatus: Under review\n[${getKenyaTime()}]\n(Tip: "00" for Main Menu)`);
        session.state = 'awaiting_menu_selection';
        await notifyAdmins(`🔔 *Deposit Request!*\nUser: ${user.firstName} ${user.secondName} (${user.phone})\nAmount: Ksh ${amt}\nID: ${dep.depositID}\n[${getKenyaTime()}]`);
      }
      break;
    }
    case 'change_pin':
      if (msgBody !== user.withdrawalPIN)
        await message.reply(`❌ Incorrect PIN. Try again or type "0" to cancel.`);
      else {
        updateState(session, 'new_pin');
        await message.reply(`🔑 Enter your new 4-digit PIN.\n(Tip: "0" to go back, "00" for Main Menu)`);
      }
      break;
    case 'new_pin':
      if (!/^\d{4}$/.test(msgBody))
        await message.reply(`❌ That PIN isn’t valid. Enter a 4-digit PIN.`);
      else {
        user.withdrawalPIN = msgBody;
        saveUsers();
        await message.reply(`✅ PIN changed successfully!\n[${getKenyaTime()}]\n(Tip: "00" for Main Menu)`);
        session.state = 'awaiting_menu_selection';
      }
      break;
    case 'update_profile_menu':
      switch (msgBody) {
        case '1':
          updateState(session, 'update_profile_firstname');
          await message.reply(`✍️ Enter your new *First Name*:\n(Tip: "0" to go back)`);
          break;
        case '2':
          updateState(session, 'update_profile_secondname');
          await message.reply(`✍️ Enter your new *Second Name*:\n(Tip: "0" to go back)`);
          break;
        case '3':
          updateState(session, 'update_profile_phone');
          await message.reply(`✍️ Enter your new *Phone Number* (070/01, 10 digits):\n(Tip: "0" to go back)`);
          break;
        default:
          await message.reply(`❓ Option not recognized. Reply with 1, 2, or 3.\n(Tip: "0" to go back, "00" for Main Menu)`);
          break;
      }
      break;
    case 'update_profile_firstname':
      user.firstName = msgBody;
      saveUsers();
      await message.reply(`✅ First Name updated to ${user.firstName}.\n(Tip: "00" for Main Menu)`);
      session.state = 'awaiting_menu_selection';
      break;
    case 'update_profile_secondname':
      user.secondName = msgBody;
      saveUsers();
      await message.reply(`✅ Second Name updated to ${user.secondName}.\n(Tip: "00" for Main Menu)`);
      session.state = 'awaiting_menu_selection';
      break;
    case 'update_profile_phone':
      if (!/^(070|01)\d{7}$/.test(msgBody))
        await message.reply(`❌ Invalid phone number format. Try again.`);
      else {
        user.phone = msgBody;
        saveUsers();
        await message.reply(`✅ Phone Number updated to ${user.phone}.\n(Tip: "00" for Main Menu)`);
        session.state = 'awaiting_menu_selection';
      }
      break;
    default:
      await message.reply(`🤔 I'm not sure what you mean. Type "00" for Main Menu.`);
      session.state = 'awaiting_menu_selection';
      break;
  }
}

// ---------------------------
// ADMIN COMMAND PROCESSOR
// ---------------------------
async function processAdminCommand(message) {
  const parts = message.body.trim().split(' ');
  const cmd = (parts[1] || '').toLowerCase();
  const subCmd = (parts[2] || '').toLowerCase();

  // admin CMD: list admin commands.
  if (cmd === 'cmd') {
    await message.reply(
      `⚙️ *ADMIN COMMANDS* ⚙️\n\n` +
      `1. admin CMD – Show this list.\n` +
      `2. admin view users – List all users.\n` +
      `3. admin view investments – List all investments.\n` +
      `4. admin view deposits – List all deposits.\n` +
      `5. admin approve deposit <DEP-ID> – Approve a deposit.\n` +
      `6. admin reject deposit <DEP-ID> <Reason> – Reject a deposit.\n` +
      `7. admin approve withdrawal <WD-ID> – Approve a withdrawal.\n` +
      `8. admin reject withdrawal <WD-ID> <Reason> – Reject a withdrawal.\n` +
      `9. admin ban user <phone> <Reason> – Ban a user.\n` +
      `10. admin add admin <phone> – Add a new admin (Super Admin only).\n` +
      `11. admin addbalance <phone> <amount> – Add funds to a user’s balance.\n` +
      `12. admin deductbalance <phone> <amount> – Deduct funds from a user’s balance.\n` +
      `13. admin unban <phone> – Unban a user.\n` +
      `14. admin setwithdrawallimits <min> <max> – Set withdrawal limits.\n` +
      `15. admin setdepositlimits <min> <max> – Set deposit limits.\n` +
      `16. admin setdepositinfo <M-Pesa_Number> <Name> – Update deposit details.\n` +
      `17. admin setreturn <percentage> – Set investment return percentage.\n` +
      `18. admin matureinvestments – Mature investments older than 24hrs.\n` +
      `19. admin cancelinvestment <phone> <investment_index> – Cancel a user's investment.\n` +
      `20. admin setrefbonus <percentage> – Set referral bonus percentage.\n` +
      `21. admin setwelcome <message> – Set custom welcome message.\n` +
      `22. admin sendreminder <message> – Broadcast reminder to all users.\n` +
      `23. admin maintenance <on/off> – Toggle maintenance mode.\n` +
      `24. admin leaderboard <on/off> – Toggle leaderboard feature.\n` +
      `25. admin setrewardrate <rate> – Set reward points per Ksh invested.\n` +
      `26. admin addpoints <phone> <points> – Add reward points to a user.\n` +
      `27. admin deductpoints <phone> <points> – Deduct reward points from a user.\n` +
      `28. admin addpackage <name> <min> <max> <returnPercent> <duration_days> – Add an investment package.\n` +
      `29. admin viewpackages – View all investment packages.\n\n` +
      `[${getKenyaTime()}]`
    );
    return;
  }
  // (All previously defined admin commands from our code are included here.)
  if (cmd === 'view' && subCmd === 'users') {
    let list = Object.values(users).map(u => `${u.firstName} ${u.secondName} (Phone: ${u.phone})`).join('\n');
    if (!list) list = "No users registered.";
    await message.reply(`📋 *User List:*\n\n${list}\n\n[${getKenyaTime()}]`);
    return;
  }
  if (cmd === 'view' && subCmd === 'investments') {
    let invList = "";
    Object.values(users).forEach(u => { u.investments.forEach((inv, i) => { invList += `${u.firstName} ${u.secondName} – Investment ${i+1}: Ksh ${inv.amount}, Return: Ksh ${inv.expectedReturn}, Status: ${inv.status}${inv.matured ? " (Matured)" : ""}\n`; }); });
    if (!invList) invList = "No investments found.";
    await message.reply(`📊 *Investments:*\n\n${invList}\n[${getKenyaTime()}]`);
    return;
  }
  if (cmd === 'view' && subCmd === 'deposits') {
    let depList = "";
    Object.values(users).forEach(u => { u.deposits.forEach((dep, i) => { depList += `${u.firstName} ${u.secondName} – Deposit ${i+1}: ID: ${dep.depositID}, Amount: Ksh ${dep.amount}, Status: ${dep.status}\n`; }); });
    if (!depList) depList = "No deposits found.";
    await message.reply(`💰 *Deposits:*\n\n${depList}\n[${getKenyaTime()}]`);
    return;
  }
  if (cmd === 'approve' && subCmd === 'deposit') {
    const depID = parts[3];
    if (!depID) { await message.reply("Usage: admin approve deposit <DEP-ID>"); return; }
    let found = false;
    Object.values(users).forEach(u => { u.deposits.forEach(dep => { if (dep.depositID.toLowerCase() === depID.toLowerCase()) { dep.status = 'approved'; u.accountBalance += parseFloat(dep.amount); found = true; } }); });
    if (found) { saveUsers(); await message.reply(`✅ Deposit ${depID} approved!\n[${getKenyaTime()}]`); }
    else await message.reply(`❌ Deposit ID not found: ${depID}`);
    return;
  }
  if (cmd === 'reject' && subCmd === 'deposit') {
    const depID = parts[3];
    if (!depID) { await message.reply("Usage: admin reject deposit <DEP-ID> <Reason>"); return; }
    const reason = parts.slice(4).join(' ') || "No reason given";
    let found = false;
    Object.values(users).forEach(u => { u.deposits.forEach(dep => { if (dep.depositID.toLowerCase() === depID.toLowerCase()) { dep.status = `rejected (${reason})`; found = true; } }); });
    if (found) { saveUsers(); await message.reply(`❌ Deposit ${depID} rejected.\nReason: ${reason}\n[${getKenyaTime()}]`); }
    else await message.reply(`Deposit ID not found: ${depID}`);
    return;
  }
  if (cmd === 'approve' && subCmd === 'withdrawal') {
    const wdID = parts[3];
    if (!wdID) { await message.reply("Usage: admin approve withdrawal <WD-ID>"); return; }
    let found = false;
    Object.values(users).forEach(u => { u.withdrawals.forEach(wd => { if (wd.withdrawalID.toLowerCase() === wdID.toLowerCase()) { wd.status = 'approved'; found = true; } }); });
    if (found) { saveUsers(); await message.reply(`✅ Withdrawal ${wdID} approved!\n[${getKenyaTime()}]`); }
    else await message.reply(`❌ Withdrawal ID not found: ${wdID}`);
    return;
  }
  if (cmd === 'reject' && subCmd === 'withdrawal') {
    const wdID = parts[3];
    if (!wdID) { await message.reply("Usage: admin reject withdrawal <WD-ID> <Reason>"); return; }
    const reason = parts.slice(4).join(' ') || "No reason given";
    let found = false;
    Object.values(users).forEach(u => { u.withdrawals.forEach(wd => { if (wd.withdrawalID.toLowerCase() === wdID.toLowerCase()) { wd.status = `rejected (${reason})`; found = true; } }); });
    if (found) { saveUsers(); await message.reply(`❌ Withdrawal ${wdID} rejected.\nReason: ${reason}\n[${getKenyaTime()}]`); }
    else await message.reply(`Withdrawal ID not found: ${wdID}`);
    return;
  }
  if (cmd === 'ban' && subCmd === 'user') {
    let phone = parts[3];
    if (!phone) { await message.reply("Usage: admin ban user <phone> <Reason>"); return; }
    let reason = parts.slice(4).join(' ') || "No reason provided";
    if (users[phone]) {
      if (users[phone].whatsAppId.replace(/\D/g, '') === SUPER_ADMIN) { await message.reply("🚫 Cannot ban the Super Admin!"); return; }
      users[phone].banned = true;
      saveUsers();
      await message.reply(`🚫 User ${phone} banned.\nReason: ${reason}\n[${getKenyaTime()}]`);
    } else await message.reply(`User with phone ${phone} not found.`);
    return;
  }
  if (cmd === 'add' && subCmd === 'admin') {
    if (message.from.replace(/\D/g, '') !== SUPER_ADMIN) { await message.reply("🚫 Only the Super Admin can add new admins."); return; }
    let newPhone = parts[3]?.replace(/\D/g, '');
    if (!newPhone) { await message.reply("Usage: admin add admin <phone>"); return; }
    if (!admins.includes(newPhone)) { admins.push(newPhone); await message.reply(`✅ ${newPhone} added as admin.`); }
    else await message.reply(`ℹ️ ${newPhone} is already an admin.`);
    return;
  }
  if (cmd === 'addbalance') {
    let phone = parts[2];
    let amt = parseFloat(parts[3]);
    if (!phone || isNaN(amt)) { await message.reply("Usage: admin addbalance <phone> <amount>"); return; }
    if (!users[phone]) { await message.reply(`User with phone ${phone} not found.`); return; }
    users[phone].accountBalance += amt;
    saveUsers();
    await message.reply(`✅ Added Ksh ${amt} to ${phone}. New balance: Ksh ${users[phone].accountBalance}`);
    try { await client.sendMessage(users[phone].whatsAppId, `💰 Your account has been credited with Ksh ${amt}. New balance: Ksh ${users[phone].accountBalance}`); }
    catch (err) { console.error(err); }
    return;
  }
  if (cmd === 'deductbalance') {
    let phone = parts[2];
    let amt = parseFloat(parts[3]);
    if (!phone || isNaN(amt)) { await message.reply("Usage: admin deductbalance <phone> <amount>"); return; }
    if (!users[phone]) { await message.reply(`User with phone ${phone} not found.`); return; }
    users[phone].accountBalance = Math.max(0, users[phone].accountBalance - amt);
    saveUsers();
    await message.reply(`✅ Deducted Ksh ${amt} from ${phone}. New balance: Ksh ${users[phone].accountBalance}`);
    try { await client.sendMessage(users[phone].whatsAppId, `⚠️ Ksh ${amt} has been deducted from your account. New balance: Ksh ${users[phone].accountBalance}`); }
    catch (err) { console.error(err); }
    return;
  }
  if (cmd === 'unban') {
    let phone = parts[2];
    if (!phone) { await message.reply("Usage: admin unban <phone>"); return; }
    if (!users[phone]) { await message.reply(`User with phone ${phone} not found.`); return; }
    users[phone].banned = false;
    saveUsers();
    await message.reply(`✅ User ${phone} has been unbanned.`);
    try { await client.sendMessage(users[phone].whatsAppId, `🎉 You have been unbanned from FY'S INVESTMENT BOT.`); }
    catch (err) { console.error(err); }
    return;
  }
  if (cmd === 'setwithdrawallimits') {
    let min = parseFloat(parts[2]), max = parseFloat(parts[3]);
    if (isNaN(min) || isNaN(max)) { await message.reply("Usage: admin setwithdrawallimits <min> <max>"); return; }
    withdrawalMin = min; withdrawalMax = max;
    await message.reply(`✅ Withdrawal limits set: Min Ksh ${withdrawalMin}, Max Ksh ${withdrawalMax}.\n[${getKenyaTime()}]`);
    return;
  }
  if (cmd === 'setdepositlimits') {
    let min = parseFloat(parts[2]), max = parseFloat(parts[3]);
    if (isNaN(min) || isNaN(max)) { await message.reply("Usage: admin setdepositlimits <min> <max>"); return; }
    depositMin = min; depositMax = max;
    await message.reply(`✅ Deposit limits set: Min Ksh ${depositMin}, Max Ksh ${depositMax}.\n[${getKenyaTime()}]`);
    return;
  }
  if (cmd === 'setdepositinfo') {
    let mpesa = parts[2], name = parts.slice(3).join(' ');
    if (!mpesa || !name) { await message.reply("Usage: admin setdepositinfo <M-Pesa_Number> <Name>"); return; }
    depositInfo.number = mpesa; depositInfo.name = name;
    await message.reply(`✅ Deposit info updated: ${depositInfo.number} (Name: ${depositInfo.name}).\n[${getKenyaTime()}]`);
    return;
  }
  if (cmd === 'setreturn') {
    let perc = parseFloat(parts[2]);
    if (isNaN(perc)) { await message.reply("Usage: admin setreturn <percentage>"); return; }
    investmentReturnPercent = perc;
    await message.reply(`✅ Investment return percentage set to ${investmentReturnPercent}%.\n[${getKenyaTime()}]`);
    return;
  }
  if (cmd === 'matureinvestments') {
    let count = 0;
    Object.values(users).forEach(u => {
      u.investments.forEach(inv => {
        if (!inv.matured && (Date.now() - inv.timestamp) >= 24*60*60*1000) {
          inv.matured = true; inv.status = 'matured';
          u.accountBalance += parseFloat(inv.expectedReturn);
          count++;
        }
      });
    });
    saveUsers();
    await message.reply(`✅ Matured ${count} investments. Returns credited.\n[${getKenyaTime()}]`);
    return;
  }
  if (cmd === 'cancelinvestment') {
    let phone = parts[2], index = parseInt(parts[3]) - 1;
    if (!phone || isNaN(index)) { await message.reply("Usage: admin cancelinvestment <phone> <investment_index>"); return; }
    if (!users[phone]) { await message.reply(`User with phone ${phone} not found.`); return; }
    let inv = users[phone].investments[index];
    if (!inv) { await message.reply(`No investment found at index ${index+1} for ${phone}.`); return; }
    if (inv.matured) { await message.reply("Cannot cancel a matured investment."); return; }
    users[phone].accountBalance += inv.amount;
    inv.status = 'cancelled';
    saveUsers();
    await message.reply(`✅ Investment #${index+1} for ${phone} cancelled and amount refunded.\n[${getKenyaTime()}]`);
    try { await client.sendMessage(users[phone].whatsAppId, `⚠️ Your investment of Ksh ${inv.amount} has been cancelled and refunded.`); }
    catch (err) { console.error(err); }
    return;
  }
  // New admin commands:
  if (cmd === 'setrefbonus') {
    let perc = parseFloat(parts[2]);
    if (isNaN(perc)) { await message.reply("Usage: admin setrefbonus <percentage>"); return; }
    referralBonusPercent = perc;
    await message.reply(`✅ Referral bonus percentage set to ${referralBonusPercent}%.\n[${getKenyaTime()}]`);
    return;
  }
  if (cmd === 'setwelcome') {
    let msg = parts.slice(2).join(' ');
    if (!msg) { await message.reply("Usage: admin setwelcome <message>"); return; }
    customWelcomeMessage = msg;
    await message.reply(`✅ Welcome message updated to:\n${customWelcomeMessage}\n[${getKenyaTime()}]`);
    return;
  }
  if (cmd === 'sendreminder') {
    let reminder = parts.slice(2).join(' ');
    if (!reminder) { await message.reply("Usage: admin sendreminder <message>"); return; }
    Object.values(users).forEach(u => { client.sendMessage(u.whatsAppId, `🔔 Reminder: ${reminder}\n[${getKenyaTime()}]`); });
    await message.reply(`✅ Reminder sent to all users.\n[${getKenyaTime()}]`);
    return;
  }
  if (cmd === 'maintenance') {
    let mode = parts[2]?.toLowerCase();
    if (mode === 'on') { maintenanceMode = true; await message.reply("🚧 Maintenance mode enabled."); }
    else if (mode === 'off') { maintenanceMode = false; await message.reply("✅ Maintenance mode disabled."); }
    else { await message.reply("Usage: admin maintenance on/off"); }
    return;
  }
  if (cmd === 'leaderboard') {
    let state = parts[2]?.toLowerCase();
    if (state === 'on') { leaderboardEnabled = true; await message.reply("✅ Leaderboard feature enabled."); }
    else if (state === 'off') { leaderboardEnabled = false; await message.reply("✅ Leaderboard feature disabled."); }
    else { await message.reply("Usage: admin leaderboard on/off"); }
    return;
  }
  if (cmd === 'setrewardrate') {
    let rate = parseFloat(parts[2]);
    if (isNaN(rate)) { await message.reply("Usage: admin setrewardrate <rate>"); return; }
    rewardRate = rate;
    await message.reply(`✅ Reward rate set to ${rewardRate} point(s) per Ksh invested.\n[${getKenyaTime()}]`);
    return;
  }
  if (cmd === 'addpoints') {
    let phone = parts[2], pts = parseFloat(parts[3]);
    if (!phone || isNaN(pts)) { await message.reply("Usage: admin addpoints <phone> <points>"); return; }
    if (!users[phone]) { await message.reply(`User with phone ${phone} not found.`); return; }
    users[phone].rewardPoints = (users[phone].rewardPoints || 0) + pts;
    saveUsers();
    await message.reply(`✅ Added ${pts} points to ${phone}. Total: ${users[phone].rewardPoints} points.`);
    return;
  }
  if (cmd === 'deductpoints') {
    let phone = parts[2], pts = parseFloat(parts[3]);
    if (!phone || isNaN(pts)) { await message.reply("Usage: admin deductpoints <phone> <points>"); return; }
    if (!users[phone]) { await message.reply(`User with phone ${phone} not found.`); return; }
    users[phone].rewardPoints = Math.max(0, (users[phone].rewardPoints || 0) - pts);
    saveUsers();
    await message.reply(`✅ Deducted ${pts} points from ${phone}. Total: ${users[phone].rewardPoints} points.`);
    return;
  }
  if (cmd === 'addpackage') {
    let name = parts[2], min = parseFloat(parts[3]), max = parseFloat(parts[4]),
        ret = parseFloat(parts[5]), dur = parseInt(parts[6]);
    if (!name || isNaN(min) || isNaN(max) || isNaN(ret) || isNaN(dur)) {
      await message.reply("Usage: admin addpackage <name> <min> <max> <returnPercent> <duration_in_days>");
      return;
    }
    investmentPackages.push({ name, min, max, returnPercent: ret, durationDays: dur });
    await message.reply(`✅ Package "${name}" added: Min Ksh ${min}, Max Ksh ${max}, Return ${ret}%, Duration ${dur} days.`);
    return;
  }
  if (cmd === 'viewpackages') {
    if (investmentPackages.length === 0) { await message.reply("📦 No investment packages available."); return; }
    let pkgText = investmentPackages.map((p, i) => `${i+1}. ${p.name} – Min: Ksh ${p.min}, Max: Ksh ${p.max}, Return: ${p.returnPercent}%, Duration: ${p.durationDays} days`).join('\n');
    await message.reply(`📦 *Investment Packages:*\n${pkgText}`);
    return;
  }
  await message.reply(`❓ Unrecognized admin command. Type "admin CMD" to see all commands.\n[${getKenyaTime()}]`);
}

// ---------------------------
// MAIN MENU HELPER
// ---------------------------
function mainMenuText() {
  return (
    `🌟 *FY'S INVESTMENT BOT Main Menu* 🌟\nCurrent Time: ${getKenyaTime()}\n\n` +
    `Please choose an option:\n` +
    `1. Invest 💰\n` +
    `2. Check Balance 🔍\n` +
    `3. Withdraw Earnings 💸\n` +
    `4. Deposit Funds 💵\n` +
    `5. Change PIN 🔐\n` +
    `6. My Referral Link 🔗\n` +
    `7. Referral History 👥\n` +
    `8. Update Profile ✍️\n\n` +
    `Tip: Type "0" to go back or "00" to return to this menu anytime!`
  );
}

// ---------------------------
// POLL PENDING DEPOSITS VIA API (Automatic Integration)
// ---------------------------
async function pollPendingDeposits() {
  // Loop through all users and their deposits with status "under review"
  for (const phone in users) {
    let user = users[phone];
    for (let dep of user.deposits) {
      if (dep.status === 'under review') {
        try {
          // Call the external API (replace URL with your actual API endpoint)
          const response = await axios.get(`${DEPOSIT_STATUS_API}?depositId=${dep.depositID}`);
          // Assume response.data.status returns "confirmed" or "rejected"
          if (response.data.status === 'confirmed') {
            dep.status = 'confirmed';
            user.accountBalance += parseFloat(dep.amount);
            console.log(`Deposit ${dep.depositID} confirmed via API. Added Ksh ${dep.amount} to user ${user.phone}`);
          } else if (response.data.status === 'rejected') {
            dep.status = 'rejected';
          }
        } catch (err) {
          console.error(`Error checking deposit ${dep.depositID}:`, err.message);
        }
      }
    }
  }
  saveUsers();
}
// Poll every 60 seconds
setInterval(pollPendingDeposits, 60000);

// ---------------------------
// START THE WHATSAPP CLIENT
// ---------------------------
client.initialize();
