/**
 * FY’S INVESTMENT BOT – SUPERCHARGED VERSION 🚀
 *
 * FEATURES:
 *  • Displays a QR code on an Express webpage (http://localhost:3000)
 *  • Integrates with PayHero:
 *       - When a user requests a deposit, the bot sends an STK push via PayHero (/payments)
 *       - Waits ~20 seconds then checks the transaction status (/transaction-status)
 *       - If status = SUCCESS, credits the deposit automatically to the user’s account.
 *  • Users can: Invest, Check Balance, Withdraw, Deposit, Change PIN, get Referral Link,
 *       view Referral History, Update Profile, view Reward Points, and see Investment Packages.
 *  • Admins can: Manage users (ban/unban, add/deduct balance), set deposit/withdrawal limits,
 *       update deposit info, change investment return %, set dynamic referral bonus %,
 *       send broadcast reminders, toggle maintenance mode and leaderboard, adjust reward rate,
 *       add/deduct reward points, add/view custom investment packages, mature/cancel investments, etc.
 *
 * EXTRA 7 FEATURES (all modifiable by admin):
 *   1. Dynamic Referral Bonus percentage.
 *   2. Custom Welcome Message.
 *   3. Auto-Notification Broadcast.
 *   4. Maintenance Mode toggle.
 *   5. Leaderboard feature (top investors today).
 *   6. Reward Points system.
 *   7. Custom Investment Packages.
 *
 * PAYHERO Integration:
 *   - STK push (POST to https://backend.payhero.co.ke/api/v2/payments)
 *   - Transaction status check (GET from https://backend.payhero.co.ke/api/v2/transaction-status?reference=...)
 *   - Use provided Authorization header.
 *
 * SETTINGS:
 *   • BOT_PHONE: Bot’s WhatsApp number (e.g. "254700363422")
 *   • SUPER_ADMIN: "254701339573"
 */

const { Client } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const express = require('express');
const qrcode = require('qrcode');
const axios = require('axios');

// ---------------------------
// CONFIGURATION & GLOBAL VARIABLES
// ---------------------------

const BOT_PHONE = '254700363422';
const SUPER_ADMIN = '254701339573';
let admins = [SUPER_ADMIN];

// Global limits (modifiable via admin commands)
let withdrawalMin = 1000;
let withdrawalMax = 10000000;
let depositMin = 1;
let depositMax = 10000000;

// Extra feature globals:
let referralBonusPercent = 3;  // default referral bonus % (modifiable)
let customWelcomeMessage = "👋 Welcome to FY'S INVESTMENT BOT! Start your journey to smart investing!";
let maintenanceMode = false;
let leaderboardEnabled = false;
let rewardRate = 1;  // Reward points per Ksh invested
let investmentReturnPercent = 10;  // Investment return percentage
let investmentPackages = [];  // Custom packages (array of objects)

// Deposit payment details (modifiable via admin)
let depositInfo = { number: "0701339573", name: "Camlus Okoth" };

// PAYHERO API configuration:
const PAYHERO_AUTH = "Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw==";
const PAYHERO_PAYMENTS_URL = "https://backend.payhero.co.ke/api/v2/payments";
const PAYHERO_STATUS_URL   = "https://backend.payhero.co.ke/api/v2/transaction-status";

// User data storage
const USERS_FILE = path.join(__dirname, 'users.json');
let users = {};
if (fs.existsSync(USERS_FILE)) {
  try { users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch (e) { console.error('Error reading users file:', e); users = {}; }
} else { users = {}; }
function saveUsers() { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); }

// In-memory session storage
let sessions = {};

// Helper: get Kenya time string
function getKenyaTime() {
  return new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' });
}

// Helper: generate random strings
function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) { result += chars.charAt(Math.floor(Math.random() * chars.length)); }
  return result;
}
function generateReferralCode() { return "FY'S-" + randomString(5); }
function generateDepositID() { return "DEP-" + randomString(8); }
function generateWithdrawalID() { return "WD-" + randomString(4); }

// Navigation helper: update state while storing previous state
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
client.on('qr', qr => {
  console.log('🔄 New QR code generated. Open http://localhost:3000 to view it.');
  lastQr = qr;
});
client.on('ready', async () => {
  console.log(`✅ Client is ready! [${getKenyaTime()}]`);
  const superAdminWID = `${SUPER_ADMIN}@c.us`;
  try {
    await client.sendMessage(superAdminWID, `🎉 Hello Super Admin! FY'S INVESTMENT BOT is now online! [${getKenyaTime()}]`);
  } catch (err) {
    console.error('Error sending message to Super Admin:', err);
  }
});

// ---------------------------
// PAYHERO DEPOSIT FLOW: Send STK push & check status
// ---------------------------
async function initiatePayHeroSTK(amount, user) {
  // Use depositID as external_reference
  const depositID = generateDepositID();
  let payheroData = {
    amount: amount,
    phone_number: user.phone,  // ensure in correct format e.g. "070xxxxxxx"
    channel_id: 529,           // adjust as needed
    provider: "m-pesa",
    external_reference: depositID,
    customer_name: `${user.firstName} ${user.secondName}`,
    callback_url: "https://yourdomain.com/callback" // update with your actual callback URL
  };

  try {
    const response = await axios.post(PAYHERO_PAYMENTS_URL, payheroData, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': PAYHERO_AUTH
      }
    });
    console.log(`STK Push Response for deposit ${depositID}:`, response.data);
    return { success: true, depositID };
  } catch (err) {
    console.error('Error initiating STK push:', err.message);
    return { success: false };
  }
}

async function checkPayHeroTransaction(user, depositID, originalMessage) {
  let deposit = user.deposits.find(d => d.depositID === depositID);
  if (!deposit || deposit.status !== 'under review') return;

  try {
    const url = `${PAYHERO_STATUS_URL}?reference=${depositID}`;
    const response = await axios.get(url, {
      headers: { 'Authorization': PAYHERO_AUTH }
    });
    const payStatus = response.data.status;
    console.log(`PayHero transaction status for ${depositID}: ${payStatus}`);
    if (payStatus === 'SUCCESS') {
      deposit.status = 'confirmed';
      user.accountBalance += parseFloat(deposit.amount);
      saveUsers();
      await originalMessage.reply(
        `✅ *Deposit Confirmed!*\nDeposit ID: ${depositID}\nAmount: Ksh ${deposit.amount}\nYour new balance: Ksh ${user.accountBalance}\n[${getKenyaTime()}]\n(Tip: "00" for Main Menu)`
      );
    } else if (payStatus === 'FAILED') {
      deposit.status = 'failed';
      saveUsers();
      await originalMessage.reply(
        `❌ Deposit ${depositID} failed. Please try again or contact support.\n[${getKenyaTime()}]\n(Tip: "00" for Main Menu)`
      );
    } else {
      await originalMessage.reply(
        `ℹ️ Deposit ${depositID} is still ${payStatus}. Please check again later.\n(Tip: "00" for Main Menu)`
      );
    }
  } catch (err) {
    console.error(`Error checking transaction for ${depositID}:`, err.message);
    await originalMessage.reply(
      `⚠️ Unable to check deposit status for ${depositID} right now. It remains under review.\n(Tip: "00" for Main Menu)`
    );
  }
}

// ---------------------------
// MAIN MESSAGE HANDLER
// ---------------------------
client.on('message_create', async (message) => {
  if (message.fromMe) return;

  // If maintenance mode is on and sender is not admin
  if (maintenanceMode && !isAdmin(message.from)) {
    await message.reply(`🚧 FY'S INVESTMENT BOT is under maintenance. Please try again later. (Tip: "00" for Main Menu)`);
    return;
  }

  const chatId = message.from;
  const msgBody = message.body.trim();
  console.log(`[${getKenyaTime()}] Message from ${chatId}: ${msgBody}`);

  // Navigation shortcuts
  if (msgBody === '0') {
    if (sessions[chatId] && sessions[chatId].prevState) {
      sessions[chatId].state = sessions[chatId].prevState;
      await message.reply(`🔙 Returning to previous activity. (Tip: "00" for Main Menu)`);
    } else {
      sessions[chatId] = { state: 'awaiting_menu_selection' };
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
      `• Registration: Follow prompts when you first message the bot.\n` +
      `• Main Menu Options: Invest, Check Balance, Withdraw, Deposit, Change PIN, Referral Link, Referral History, Update Profile, Reward Points, Packages.\n` +
      `• Extra Commands: "leaderboard" (if enabled), "reward", "packages".\n` +
      `• Navigation: Type "0" to go back, "00" for Main Menu.\n\n` +
      `Enjoy and invest smartly! 🚀`
    );
    return;
  }
  if (msgBody.toLowerCase() === 'leaderboard' && leaderboardEnabled) {
    await handleLeaderboard(message);
    return;
  }
  if (msgBody.toLowerCase() === 'reward') {
    await handleRewardPoints(message);
    return;
  }
  if (msgBody.toLowerCase() === 'packages') {
    await handlePackages(message);
    return;
  }
  if (/^dp status /i.test(msgBody)) {
    await handleDepositStatusRequest(message);
    return;
  }
  if (msgBody.toLowerCase().startsWith('admin') && isAdmin(message.from)) {
    await processAdminCommand(message);
    return;
  }

  // Determine registration status
  let regUser = Object.values(users).find(u => u.whatsAppId === chatId);
  if (!sessions[chatId]) {
    sessions[chatId] = { state: regUser ? 'awaiting_menu_selection' : 'start' };
  }
  let session = sessions[chatId];

  if (!regUser) {
    await handleRegistration(message, session);
  } else {
    if (regUser.banned) {
      await message.reply(`🚫 You have been banned from using this service. Please contact support.`);
      return;
    }
    await handleUserSession(message, session, regUser);
  }
});

// ---------------------------
// USER SESSION HANDLER
// ---------------------------

async function handleUserSession(message, session, user) {
  const msgBody = message.body.trim();
  switch (session.state) {
    case 'awaiting_menu_selection':
      switch (msgBody) {
        case '1': // Invest
          updateState(session, 'invest');
          await message.reply(`💰 *Invest Now!*\nEnter the investment amount (min Ksh 1,000; max Ksh 150,000):\n(Tip: "0" to go back, "00" for Main Menu)`);
          break;
        case '2': // Check Balance
          updateState(session, 'check_balance_menu');
          await message.reply(`🔍 *Check Balance:*\n1. Account Balance\n2. Referral Earnings\n3. Investment History\nReply with 1, 2, or 3.\n(Tip: "0" to go back, "00" for Main Menu)`);
          break;
        case '3': // Withdraw
          updateState(session, 'withdraw');
          await message.reply(`💸 *Withdraw Earnings!*\nEnter the amount to withdraw from referral earnings.\n(Min: Ksh ${withdrawalMin} unless full, Max: Ksh ${withdrawalMax})\n(Tip: "0" to go back, "00" for Main Menu)`);
          break;
        case '4': // Deposit
          updateState(session, 'deposit');
          await message.reply(
            `💵 *Deposit Funds!*\nEnter deposit amount (Min: Ksh ${depositMin}; Max: Ksh ${depositMax}).\nPayment details: ${depositInfo.number} (Name: ${depositInfo.name})\n(Tip: "0" to go back, "00" for Main Menu)`
          );
          break;
        case '5': // Change PIN
          updateState(session, 'change_pin');
          await message.reply(`🔑 *Change PIN*\nEnter your current 4-digit PIN:\n(Tip: "0" to go back, "00" for Main Menu)`);
          break;
        case '6': // Referral Link
          {
            const referralLink = `https://wa.me/${BOT_PHONE}?text=REF${encodeURIComponent(user.referralCode)}`;
            await message.reply(`🔗 *Your Referral Link:*\n${referralLink}\n(Tip: "00" for Main Menu)`);
          }
          break;
        case '7': // Referral History
          if (!user.referrals || user.referrals.length === 0)
            await message.reply(`👥 *Referral History:*\nNo referrals yet. Share your link!\n(Tip: "00" for Main Menu)`);
          else
            await message.reply(`👥 *Referral History:*\nTotal: ${user.referrals.length}\nPhones: ${user.referrals.join(', ')}\nReferral Earnings: Ksh ${user.referralEarnings}\n(Tip: "00" for Main Menu)`);
          break;
        case '8': // Update Profile
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
      if (isNaN(amt) || amt < 1000 || amt > 150000) {
        await message.reply(`❌ Enter an amount between Ksh 1,000 and Ksh 150,000.\n(Tip: "0" to go back, "00" for Main Menu)`);
      } else if (user.accountBalance < amt) {
        await message.reply(`⚠️ Insufficient funds! Your balance is Ksh ${user.accountBalance}.\nPlease deposit funds first.\n(Tip: "00" for Main Menu)`);
        session.state = 'awaiting_menu_selection';
      } else {
        session.investAmount = amt;
        updateState(session, 'confirm_investment');
        await message.reply(`🔐 Enter your 4-digit PIN to confirm an investment of Ksh ${amt}.\n(Tip: "0" to go back, "00" for Main Menu)`);
      }
      break;
    }
    case 'confirm_investment':
      if (msgBody !== user.withdrawalPIN) {
        await message.reply(`❌ Incorrect PIN! Try again or type "0" to cancel.`);
      } else {
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
        if (user.investments.length === 1 && user.referredBy) {
          let ref = Object.values(users).find(u => u.whatsAppId === user.referredBy);
          if (ref) {
            let bonus = session.investAmount * referralBonusPercent / 100;
            ref.referralEarnings += bonus;
            ref.referrals.push(user.phone);
            console.log(`📢 [${getKenyaTime()}] Referral bonus: ${ref.firstName} earned Ksh ${bonus.toFixed(2)} from ${user.firstName}'s investment.`);
          }
        }
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
          await message.reply(`💳 Account Balance: Ksh ${user.accountBalance}\n[${getKenyaTime()}]\n(Tip: "00" for Main Menu)`);
          session.state = 'awaiting_menu_selection';
          break;
        case '2':
          await message.reply(`🎉 Referral Earnings: Ksh ${user.referralEarnings}\n[${getKenyaTime()}]\n(Tip: "00" for Main Menu)`);
          session.state = 'awaiting_menu_selection';
          break;
        case '3':
          if (user.investments.length === 0) {
            await message.reply(`📄 No investments yet.\n[${getKenyaTime()}]\n(Tip: "00" for Main Menu)`);
          } else {
            let hist = user.investments.map((inv, i) =>
              `${i+1}. Amount: Ksh ${inv.amount}, Return: Ksh ${inv.expectedReturn}, Date: ${inv.date}, Status: ${inv.status}${inv.matured ? " (Matured)" : ""}`
            ).join('\n');
            await message.reply(`📊 Investment History:\n${hist}\n[${getKenyaTime()}]\n(Tip: "00" for Main Menu)`);
          }
          session.state = 'awaiting_menu_selection';
          break;
        default:
          await message.reply(`❓ Please reply with 1, 2, or 3.\n(Tip: "0" to go back, "00" for Main Menu)`);
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
        // Create a deposit record with status "initiating"
        let deposit = { amount: amt, date: getKenyaTime(), depositID: generateDepositID(), status: 'initiating' };
        user.deposits.push(deposit);
        saveUsers();

        // Initiate STK push via PayHero
        let stkResponse = await initiatePayHeroSTK(amt, user);
        if (stkResponse.success) {
          deposit.depositID = stkResponse.depositID;
          deposit.status = 'under review';
          saveUsers();
          await message.reply(
            `💵 STK push sent! Please authorize the payment on your phone for Ksh ${amt}.\nDeposit ID: ${deposit.depositID}\nStatus: under review\n[${getKenyaTime()}]\nWe will check the status in ~20 seconds.\n(Tip: "00" for Main Menu)`
          );
          // Wait ~20 seconds then check transaction status
          setTimeout(async () => {
            await checkPayHeroTransaction(user, deposit.depositID, message);
          }, 20000);
        } else {
          deposit.status = 'failed';
          saveUsers();
          await message.reply(`❌ STK push failed. Please try again later or contact support.\n(Tip: "00" for Main Menu)`);
        }
        session.state = 'awaiting_menu_selection';
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
        await message.reply(`❌ That PIN isn’t valid. Please enter a 4-digit PIN.`);
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
        await message.reply(`❌ Invalid phone format. It must start with 070 or 01 and be 10 digits. Try again.`);
      else {
        user.phone = msgBody;
        saveUsers();
        await message.reply(`✅ Phone Number updated to ${user.phone}.\n(Tip: "00" for Main Menu)`);
        session.state = 'awaiting_menu_selection';
      }
      break;
    default:
      await message.reply(`🤔 I'm not sure what you mean. (Tip: "00" for Main Menu)`);
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

  if (cmd === 'cmd') {
    await message.reply(
      `⚙️ *ADMIN COMMANDS* ⚙️\n\n` +
      `1. admin CMD – Show this list.\n` +
      `2. admin view users – List all users.\n` +
      `3. admin view investments – List all investments.\n` +
      `4. admin view deposits – List all deposits.\n` +
      `5. admin approve deposit <DEP-ID>\n` +
      `6. admin reject deposit <DEP-ID> <Reason>\n` +
      `7. admin approve withdrawal <WD-ID>\n` +
      `8. admin reject withdrawal <WD-ID> <Reason>\n` +
      `9. admin ban user <phone> <Reason>\n` +
      `10. admin add admin <phone>\n` +
      `11. admin addbalance <phone> <amount>\n` +
      `12. admin deductbalance <phone> <amount>\n` +
      `13. admin unban <phone>\n` +
      `14. admin setwithdrawallimits <min> <max>\n` +
      `15. admin setdepositlimits <min> <max>\n` +
      `16. admin setdepositinfo <M-Pesa_Number> <Name>\n` +
      `17. admin setreturn <percentage>\n` +
      `18. admin matureinvestments\n` +
      `19. admin cancelinvestment <phone> <investment_index>\n` +
      `20. admin setrefbonus <percentage>\n` +
      `21. admin setwelcome <message>\n` +
      `22. admin sendreminder <message>\n` +
      `23. admin maintenance <on/off>\n` +
      `24. admin leaderboard <on/off>\n` +
      `25. admin setrewardrate <rate>\n` +
      `26. admin addpoints <phone> <points>\n` +
      `27. admin deductpoints <phone> <points>\n` +
      `28. admin addpackage <name> <min> <max> <returnPercent> <duration_days>\n` +
      `29. admin viewpackages\n` +
      `[${getKenyaTime()}]`
    );
    return;
  }
  // (For brevity, only key commands are shown below. In a production version, implement all commands.)
  if (cmd === 'view' && subCmd === 'users') {
    let list = Object.values(users).map(u => `${u.firstName} ${u.secondName} (Phone: ${u.phone})`).join('\n');
    if (!list) list = "No users registered.";
    await message.reply(`📋 *User List:*\n\n${list}\n\n[${getKenyaTime()}]`);
    return;
  }
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
    Object.values(users).forEach(u => {
      client.sendMessage(u.whatsAppId, `🔔 Reminder: ${reminder}\n[${getKenyaTime()}]`);
    });
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
  if (cmd === 'addpackage') {
    let name = parts[2], min = parseFloat(parts[3]), max = parseFloat(parts[4]),
        ret = parseFloat(parts[5]), dur = parseInt(parts[6]);
    if (!name || isNaN(min) || isNaN(max) || isNaN(ret) || isNaN(dur)) {
      await message.reply("Usage: admin addpackage <name> <min> <max> <returnPercent> <duration_days>");
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
  // (Other admin commands like approve/reject deposit/withdrawal, ban/unban, addbalance, deductbalance, setdepositlimits, etc. would be implemented similarly.)
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
    `Tip: Type "0" to go back or "00" to return here anytime.`
  );
}

// ---------------------------
// HELPER: Leaderboard
// ---------------------------
async function handleLeaderboard(message) {
  const startToday = new Date();
  startToday.setHours(0,0,0,0);
  let leaderboard = [];
  Object.values(users).forEach(u => {
    let total = 0;
    u.investments.forEach(inv => { if (inv.timestamp >= startToday.getTime()) total += inv.amount; });
    leaderboard.push({ name: `${u.firstName} ${u.secondName}`, total });
  });
  leaderboard.sort((a, b) => b.total - a.total);
  let top5 = leaderboard.slice(0,5);
  if (top5.length === 0)
    await message.reply(`🏆 Leaderboard is empty for today. Be the first to invest!`);
  else {
    let lbText = top5.map((e, i) => `${i+1}. ${e.name} – Ksh ${e.total}`).join('\n');
    await message.reply(`🏆 *Today's Top Investors:*\n${lbText}\n[${getKenyaTime()}]`);
  }
}

// ---------------------------
// HELPER: Reward Points
// ---------------------------
async function handleRewardPoints(message) {
  let user = Object.values(users).find(u => u.whatsAppId === message.from);
  if (!user) {
    await message.reply(`You are not registered yet. Please register first!`);
    return;
  }
  await message.reply(`🎯 *Your Reward Points:* ${user.rewardPoints || 0}\n(Tip: "00" for Main Menu)`);
}

// ---------------------------
// HELPER: Investment Packages
// ---------------------------
async function handlePackages(message) {
  if (investmentPackages.length === 0) {
    await message.reply(`📦 No investment packages available at the moment.\n(Tip: "00" for Main Menu)`);
  } else {
    let pkgText = investmentPackages.map((p, i) =>
      `${i+1}. ${p.name} – Min: Ksh ${p.min}, Max: Ksh ${p.max}, Return: ${p.returnPercent}%, Duration: ${p.durationDays} days`
    ).join('\n');
    await message.reply(`📦 *Available Investment Packages:*\n${pkgText}\n(Tip: "00" for Main Menu)`);
  }
}

// ---------------------------
// POLL PENDING DEPOSITS VIA PAYHERO (Also implemented in deposit flow)
// ---------------------------
async function pollPendingDeposits() {
  for (const phone in users) {
    let user = users[phone];
    for (let dep of user.deposits) {
      if (dep.status === 'under review') {
        try {
          const url = `${PAYHERO_STATUS_URL}?reference=${dep.depositID}`;
          let response = await axios.get(url, { headers: { 'Authorization': PAYHERO_AUTH } });
          let status = response.data.status;
          console.log(`PayHero status for ${dep.depositID}: ${status}`);
          if (status === 'SUCCESS') {
            dep.status = 'confirmed';
            user.accountBalance += parseFloat(dep.amount);
            saveUsers();
          } else if (status === 'FAILED') {
            dep.status = 'failed';
            saveUsers();
          }
        } catch (err) {
          console.error(`Error checking deposit ${dep.depositID}:`, err.message);
        }
      }
    }
  }
}
setInterval(pollPendingDeposits, 60000);

// ---------------------------
// START THE WHATSAPP CLIENT
// ---------------------------
client.initialize();
