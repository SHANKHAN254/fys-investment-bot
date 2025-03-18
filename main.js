/**
 * FY'S INVESTMENT BOT
 *
 * Features:
 *  • Displays the WhatsApp QR code on an Express webpage (http://localhost:3000)
 *  • Engaging, emoji-filled responses with plenty of details
 *  • Navigation shortcuts: Type "0" 🔙 to go back to the previous activity or "00" 🏠 to show the Main Menu
 *  • Users can deposit, invest, check balances, withdraw funds, change PIN, and get their referral link
 *  • Admin commands allow modifying user balances/earnings, banning/unbanning, and setting withdrawal/deposit limits and deposit info
 *
 * BOT SETTINGS:
 *  • BOT_PHONE: The bot's WhatsApp number (digits only, e.g., "254700363422")
 *  • SUPER_ADMIN: The Super Admin's number (fixed at "254701339573")
 */

const { Client } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const express = require('express');
const qrcode = require('qrcode');

// ---------------------------
// CONFIG & GLOBAL VARIABLES
// ---------------------------

// Bot’s WhatsApp number (without plus sign)
const BOT_PHONE = '254700363422';
// Super Admin – cannot be removed/edited
const SUPER_ADMIN = '254701339573';
// Start with Super Admin in admin list
let admins = [SUPER_ADMIN];

// Global limits (admin can change these)
let withdrawalMin = 1000;            // Default minimum withdrawal amount
let withdrawalMax = 10000000;        // Default maximum withdrawal amount (set high to allow full withdrawal)
let depositMin = 1;                  // Default minimum deposit amount
let depositMax = 10000000;           // Default maximum deposit amount

// Deposit payment details (admin can change)
let depositInfo = {
  number: "0701339573",
  name: "Camlus Okoth"
};

// User data file
const USERS_FILE = path.join(__dirname, 'users.json');
// In-memory sessions to track conversation state and previous state (for "back" functionality)
let sessions = {};

// Load users from file or initialize empty object
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

// Helper: get Kenya date/time in a friendly format
function getKenyaTime() {
  return new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' });
}

// Helper: generate random string for codes
function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
function generateReferralCode() {
  return "FY'S-" + randomString(5);
}
function generateDepositID() {
  return "DEP-" + randomString(8);
}
function generateWithdrawalID() {
  return "WD-" + randomString(4);
}

// Helper: go back to previous state if user types "0"
function goBack(chatId, session, message) {
  if (session.prevState) {
    session.state = session.prevState;
    message.reply(`🔙 Going back to your previous activity...`);
  } else {
    session.state = 'awaiting_menu_selection';
    message.reply(`🔙 Operation cancelled. Returning to Main Menu...\n\n${mainMenuText()}`);
  }
}

// Helper: update state while storing the previous state
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
          <p>😅 No QR code available yet. Please wait for the bot to generate one...</p>
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
app.listen(3000, () => {
  console.log('🚀 Express server running. Visit http://localhost:3000 to view the QR code.');
});

// ---------------------------
// WHATSAPP CLIENT SETUP
// ---------------------------
const client = new Client();
client.on('qr', (qr) => {
  console.log('🔄 New QR code generated. Open http://localhost:3000 to view it.');
  lastQr = qr;
});
client.on('ready', async () => {
  console.log(`✅ Client is ready! [${getKenyaTime()}]`);
  const superAdminWID = `${SUPER_ADMIN}@c.us`;
  try {
    await client.sendMessage(
      superAdminWID,
      `🎉 Hello Super Admin! FY'S INVESTMENT BOT is now online and ready to serve! [${getKenyaTime()}]`
    );
  } catch (error) {
    console.error('Error sending message to Super Admin:', error);
  }
});

// ---------------------------
// MAIN MESSAGE HANDLER
// ---------------------------
client.on('message_create', async (message) => {
  // Ignore messages sent by the bot itself
  if (message.fromMe) return;
  const chatId = message.from;
  const msgBody = message.body.trim();
  console.log(`[${getKenyaTime()}] Message from ${chatId}: ${msgBody}`);

  // Navigation shortcuts: "0" for back, "00" for Main Menu
  if (msgBody === '0') {
    if (sessions[chatId] && sessions[chatId].prevState) {
      sessions[chatId].state = sessions[chatId].prevState;
      await message.reply(`🔙 Going back to your previous activity. (Tip: Type "00" for Main Menu)`);
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

  // If an admin command is detected:
  if (msgBody.toLowerCase().startsWith('admin') && isAdmin(chatId)) {
    await processAdminCommand(message);
    return;
  }

  // Check if the message is a deposit status request: "DP status <DEP-ID>"
  if (/^dp status /i.test(msgBody)) {
    await handleDepositStatusRequest(message);
    return;
  }

  // Determine if the user is registered:
  let registeredUser = Object.values(users).find(u => u.whatsAppId === chatId);
  if (!sessions[chatId]) {
    sessions[chatId] = { state: registeredUser ? 'awaiting_menu_selection' : 'start' };
  }
  let session = sessions[chatId];
  if (!registeredUser) {
    await handleRegistration(message, session);
  } else {
    if (registeredUser.banned) {
      await message.reply(`🚫 You have been banned from using this service. Please contact support.`);
      return;
    }
    await handleUserSession(message, session, registeredUser);
  }
});

// ---------------------------
// DEPOSIT STATUS HANDLER
// ---------------------------
async function handleDepositStatusRequest(message) {
  const chatId = message.from;
  const msgBody = message.body.trim();
  const parts = msgBody.split(' ');
  if (parts.length < 3) {
    await message.reply(`❓ Please specify the deposit ID. E.g.: *DP status DEP-ABCDEFGH*\nTip: Type "0" to go back or "00" for Main Menu.`);
    return;
  }
  const depositID = parts.slice(2).join(' ');
  let user = Object.values(users).find(u => u.whatsAppId === chatId);
  if (!user) {
    await message.reply(`😕 You are not registered yet. Please register first!`);
    return;
  }
  let deposit = user.deposits.find(d => d.depositID.toLowerCase() === depositID.toLowerCase());
  if (!deposit) {
    await message.reply(`❌ No deposit found with ID: *${depositID}*.\nPlease check your ID and try again.`);
    return;
  }
  await message.reply(
    `📝 *Deposit Status*\n• Deposit ID: ${deposit.depositID}\n• Amount: Ksh ${deposit.amount}\n• Date: ${deposit.date}\n• Status: ${deposit.status}\n\n[${getKenyaTime()}]\nTip: Type "00" for Main Menu or "0" to go back.`
  );
}

// ---------------------------
// REGISTRATION HANDLER
// ---------------------------
async function handleRegistration(message, session) {
  const chatId = message.from;
  const msgBody = message.body.trim();
  switch (session.state) {
    case 'start':
      await message.reply(
        `👋 Hi there! Welcome to *FY'S INVESTMENT BOT* 😊\nLet's get you set up. Please type your *first name* to begin.`
      );
      session.state = 'awaiting_first_name';
      break;
    case 'awaiting_first_name':
      session.firstName = msgBody;
      setTimeout(async () => {
        await message.reply(`✨ Awesome, *${session.firstName}*! Now, please type your *second name*.`);
        updateState(session, 'awaiting_second_name');
      }, 2000);
      break;
    case 'awaiting_second_name':
      session.secondName = msgBody;
      await message.reply(
        `🙏 Thanks, *${session.firstName} ${session.secondName}*!\nIf you have a *referral code*, please type it now; otherwise, type *NONE*.\n(Tip: You can always type "0" to go back or "00" for Main Menu.)`
      );
      updateState(session, 'awaiting_referral_code');
      break;
    case 'awaiting_referral_code': {
      const code = msgBody.toUpperCase();
      if (code !== 'NONE') {
        let referrer = Object.values(users).find(u => u.referralCode === code);
        if (referrer) {
          session.referredBy = referrer.whatsAppId;
          await message.reply(`👍 Yay! Referral code accepted!\nNow, type your phone number (start with 070 or 01, 10 digits).`);
        } else {
          await message.reply(`⚠️ Oops, that referral code wasn’t found. We’ll proceed without it.\nPlease type your phone number (070/01, 10 digits).`);
        }
      } else {
        await message.reply(`No referral code? No worries!\nPlease type your phone number (070/01, 10 digits).`);
      }
      updateState(session, 'awaiting_phone');
      break;
    }
    case 'awaiting_phone':
      if (!/^(070|01)\d{7}$/.test(msgBody)) {
        await message.reply(`❌ Uh-oh! The phone number must start with 070 or 01 and be exactly 10 digits. Please re-enter your phone number.`);
      } else {
        session.phone = msgBody;
        await message.reply(`🔒 Great! Now, create a *4-digit PIN* for withdrawals (this secures your referral earnings).`);
        updateState(session, 'awaiting_withdrawal_pin');
      }
      break;
    case 'awaiting_withdrawal_pin':
      if (!/^\d{4}$/.test(msgBody)) {
        await message.reply(`❌ Hmm... That PIN isn’t 4 digits. Please try again with a 4-digit PIN.`);
      } else {
        session.withdrawalPIN = msgBody;
        await message.reply(`🔐 Almost there! Please create a *4-digit security PIN* (you'll be asked for this if inactive for 30 minutes).`);
        updateState(session, 'awaiting_security_pin');
      }
      break;
    case 'awaiting_security_pin':
      if (!/^\d{4}$/.test(msgBody)) {
        await message.reply(`❌ That doesn’t look like a valid 4-digit PIN. Please try again.`);
      } else {
        session.securityPIN = msgBody;
        // Create new user
        const newUser = {
          whatsAppId: chatId,
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
          banned: false
        };
        users[session.phone] = newUser;
        saveUsers();
        await message.reply(
          `🎉 *Registration Successful!* 🎉\nWelcome, *${newUser.firstName}*!\nYour referral code is: *${newUser.referralCode}*\n[${getKenyaTime()}]\n\nType "00" to view the Main Menu 🏠.`
        );
        sessions[chatId] = { state: 'awaiting_menu_selection' };
      }
      break;
    default:
      await message.reply(`😓 Something went wrong. Let’s start over.\nType "00" for Main Menu.`);
      session.state = 'awaiting_menu_selection';
      break;
  }
}

// ---------------------------
// USER SESSION HANDLER
// ---------------------------
async function handleUserSession(message, session, user) {
  const chatId = message.from;
  const msgBody = message.body.trim();
  switch (session.state) {
    case 'awaiting_menu_selection':
      // Process main menu options
      switch (msgBody) {
        case '1': // Invest
          updateState(session, 'invest');
          await message.reply(`💰 *Investment Time!*\nPlease enter the investment amount (min Ksh 1,000; max Ksh 150,000):\n(Tip: Type "0" to go back or "00" for Main Menu)`);
          break;
        case '2': // Check Balance
          updateState(session, 'check_balance_menu');
          await message.reply(
            `🔍 *Check Balance Options:*\n1. Account Balance\n2. Referral Earnings\n3. Investment History\n\nReply with 1, 2, or 3.\n(Tip: "0" to go back, "00" for Main Menu)`
          );
          break;
        case '3': // Withdraw
          updateState(session, 'withdraw');
          await message.reply(`💸 *Withdrawal Request!*\nPlease enter the amount you wish to withdraw from your referral earnings.\n(Minimum: Ksh ${withdrawalMin} unless withdrawing full earnings, Maximum: Ksh ${withdrawalMax})\n(Tip: "0" to go back, "00" for Main Menu)`);
          break;
        case '4': // Deposit
          updateState(session, 'deposit');
          await message.reply(`💵 *Deposit Funds!*\nPlease enter the deposit amount (Min: Ksh ${depositMin}; Max: Ksh ${depositMax}).\nPayment details: ${depositInfo.number} (Name: ${depositInfo.name})\n(Tip: "0" to go back, "00" for Main Menu)`);
          break;
        case '5': // Change PIN
          updateState(session, 'change_pin');
          await message.reply(`🔑 *Change PIN*\nPlease enter your current 4-digit PIN.\n(Tip: "0" to go back, "00" for Main Menu)`);
          break;
        case '6': // My Referral Link
          {
            const referralLink = `https://wa.me/${BOT_PHONE}?text=REF${encodeURIComponent(user.referralCode)}`;
            await message.reply(
              `🔗 *Your Awesome Referral Link!*\nShare this link with friends:\n${referralLink}\nThey’ll automatically chat with the bot with your referral code!\n[${getKenyaTime()}]\n(Tip: "00" for Main Menu)`
            );
            session.state = 'awaiting_menu_selection';
          }
          break;
        default:
          await message.reply(`❓ Oops! That option isn't recognized. Please enter a valid option number.\n(Tip: "00" for Main Menu)`);
          break;
      }
      break;
    case 'invest': {
      let amount = parseFloat(msgBody);
      if (isNaN(amount) || amount < 1000 || amount > 150000) {
        await message.reply(`❌ Please enter an amount between Ksh 1,000 and Ksh 150,000.\n(Tip: "0" to go back, "00" for Main Menu)`);
      } else if (user.accountBalance < amount) {
        await message.reply(`⚠️ Insufficient funds! Your account balance is Ksh ${user.accountBalance}.\nPlease deposit funds first.\n(Tip: "00" for Main Menu)`);
        session.state = 'awaiting_menu_selection';
      } else {
        session.investAmount = amount;
        updateState(session, 'confirm_investment');
        await message.reply(`🔐 Please enter your 4-digit PIN to confirm your investment of Ksh ${amount}.\n(Tip: "0" to go back, "00" for Main Menu)`);
      }
      break;
    }
    case 'confirm_investment':
      if (msgBody !== user.withdrawalPIN) {
        await message.reply(`❌ Incorrect PIN! Please try again or type "0" to cancel.`);
      } else {
        user.accountBalance -= session.investAmount;
        let investment = {
          amount: session.investAmount,
          date: getKenyaTime(),
          expectedReturn: (session.investAmount * 0.10).toFixed(2),
          status: 'active'
        };
        user.investments.push(investment);
        // Process referral bonus if this is the first investment
        if (user.investments.length === 1 && user.referredBy) {
          let referrer = Object.values(users).find(u => u.whatsAppId === user.referredBy);
          if (referrer) {
            let bonus = session.investAmount * 0.03;
            referrer.referralEarnings += bonus;
            referrer.referrals.push(user.phone);
            console.log(`📢 [${getKenyaTime()}] Referral bonus: ${referrer.firstName} earned Ksh ${bonus.toFixed(2)} from ${user.firstName}'s investment.`);
          }
        }
        saveUsers();
        await message.reply(
          `✅ Investment Confirmed!\n• Amount: Ksh ${session.investAmount}\n• Expected Return (10% in 24hrs): Ksh ${investment.expectedReturn}\n• Date: ${getKenyaTime()}\n\nThank you for investing! 🎉\n(Tip: Type "00" for Main Menu)`
        );
        session.state = 'awaiting_menu_selection';
        await notifyAdmins(`🔔 *Investment Alert!*\nUser: ${user.firstName} ${user.secondName} (${user.phone})\nInvested: Ksh ${session.investAmount}\n[${getKenyaTime()}]`);
      }
      break;
    case 'check_balance_menu':
      switch (msgBody) {
        case '1':
          await message.reply(`💳 *Account Balance:* Ksh ${user.accountBalance}\n[${getKenyaTime()}]\n(Tip: "00" for Main Menu)`);
          session.state = 'awaiting_menu_selection';
          break;
        case '2':
          await message.reply(`🎉 *Referral Earnings:* Ksh ${user.referralEarnings}\n[${getKenyaTime()}]\n(Tip: "00" for Main Menu)`);
          session.state = 'awaiting_menu_selection';
          break;
        case '3':
          if (user.investments.length === 0) {
            await message.reply(`📄 You have no investments yet.\n[${getKenyaTime()}]\n(Tip: "00" for Main Menu)`);
          } else {
            let history = user.investments.map((inv, i) =>
              `${i + 1}. Amount: Ksh ${inv.amount}, Return: Ksh ${inv.expectedReturn}, Date: ${inv.date}, Status: ${inv.status}`
            ).join('\n');
            await message.reply(`📊 *Investment History:*\n${history}\n[${getKenyaTime()}]\n(Tip: "00" for Main Menu)`);
          }
          session.state = 'awaiting_menu_selection';
          break;
        default:
          await message.reply(`❓ Please reply with 1, 2, or 3.\n(Tip: "0" to go back, "00" for Main Menu)`);
          break;
      }
      break;
    case 'withdraw': {
      let amount = parseFloat(msgBody);
      // Allow full withdrawal even if it’s below minimum or above maximum
      if (isNaN(amount)) {
        await message.reply(`❌ Please enter a valid number for withdrawal.\n(Tip: "0" to go back, "00" for Main Menu)`);
      } else if (amount !== user.referralEarnings && (amount < withdrawalMin || amount > withdrawalMax)) {
        await message.reply(`❌ Withdrawal amount must be at least Ksh ${withdrawalMin} and no more than Ksh ${withdrawalMax}, unless you're withdrawing your full earnings.\n(Tip: "0" to go back, "00" for Main Menu)`);
      } else if (user.referralEarnings < amount) {
        await message.reply(`⚠️ You only have Ksh ${user.referralEarnings} in referral earnings.\n(Tip: "00" for Main Menu)`);
        session.state = 'awaiting_menu_selection';
      } else {
        user.referralEarnings -= amount;
        let wd = {
          amount: amount,
          date: getKenyaTime(),
          withdrawalID: generateWithdrawalID(),
          status: 'pending'
        };
        user.withdrawals.push(wd);
        saveUsers();
        await message.reply(
          `✅ Withdrawal Requested!\n• Withdrawal ID: ${wd.withdrawalID}\n• Amount: Ksh ${amount}\n• Status: Under review\n[${getKenyaTime()}]\n(Tip: "00" for Main Menu)`
        );
        session.state = 'awaiting_menu_selection';
        await notifyAdmins(`🔔 *Withdrawal Request!*\nUser: ${user.firstName} ${user.secondName} (${user.phone})\nAmount: Ksh ${amount}\nWithdrawal ID: ${wd.withdrawalID}\n[${getKenyaTime()}]`);
      }
      break;
    }
    case 'deposit': {
      let amount = parseFloat(msgBody);
      if (isNaN(amount) || amount < depositMin || amount > depositMax) {
        await message.reply(`❌ Deposit amount must be between Ksh ${depositMin} and Ksh ${depositMax}.\n(Tip: "0" to go back, "00" for Main Menu)`);
      } else {
        let dep = {
          amount: amount,
          date: getKenyaTime(),
          depositID: generateDepositID(),
          status: 'under review'
        };
        user.deposits.push(dep);
        saveUsers();
        await message.reply(
          `💵 Deposit Request Received!\n• Deposit ID: ${dep.depositID}\n• Amount: Ksh ${amount}\n• Payment Details: ${depositInfo.number} (Name: ${depositInfo.name})\n• Status: Under review\n[${getKenyaTime()}]\n(Tip: "00" for Main Menu)`
        );
        session.state = 'awaiting_menu_selection';
        await notifyAdmins(`🔔 *Deposit Request!*\nUser: ${user.firstName} ${user.secondName} (${user.phone})\nAmount: Ksh ${amount}\nDeposit ID: ${dep.depositID}\n[${getKenyaTime()}]`);
      }
      break;
    }
    case 'change_pin':
      if (msgBody !== user.withdrawalPIN) {
        await message.reply(`❌ Incorrect current PIN. Please try again or type "0" to cancel.`);
      } else {
        updateState(session, 'new_pin');
        await message.reply(`🔑 Great! Now, please enter your new 4-digit PIN.\n(Tip: "0" to go back, "00" for Main Menu)`);
      }
      break;
    case 'new_pin':
      if (!/^\d{4}$/.test(msgBody)) {
        await message.reply(`❌ That PIN isn’t valid. Please enter a 4-digit PIN.`);
      } else {
        user.withdrawalPIN = msgBody;
        saveUsers();
        await message.reply(`✅ PIN changed successfully! [${getKenyaTime()}]\n(Tip: "00" for Main Menu)`);
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
  const chatId = message.from;
  const msgParts = message.body.trim().split(' ');
  const command = (msgParts[1] || '').toLowerCase();
  const subCommand = (msgParts[2] || '').toLowerCase();

  // admin CMD: show list of admin commands
  if (command === 'cmd') {
    await message.reply(
      `⚙️ *ADMIN COMMANDS* ⚙️\n\n` +
      `1. admin CMD\n   - Show this list.\n\n` +
      `2. admin view users\n   - List all registered users.\n\n` +
      `3. admin view investments\n   - List all investments.\n\n` +
      `4. admin view deposits\n   - List all deposits.\n\n` +
      `5. admin approve deposit <DEP-ID>\n   - Approve a deposit.\n\n` +
      `6. admin reject deposit <DEP-ID> <Reason>\n   - Reject a deposit.\n\n` +
      `7. admin approve withdrawal <WD-ID>\n   - Approve a withdrawal.\n\n` +
      `8. admin reject withdrawal <WD-ID> <Reason>\n   - Reject a withdrawal.\n\n` +
      `9. admin ban user <phone> <Reason>\n   - Ban a user.\n\n` +
      `10. admin add admin <phone>\n   - Add a new admin (Super Admin only).\n\n` +
      `11. admin addbalance <phone> <amount>\n   - Add funds to a user’s balance.\n\n` +
      `12. admin deductbalance <phone> <amount>\n   - Deduct funds from a user’s balance.\n\n` +
      `13. admin unban <phone>\n   - Unban a user.\n\n` +
      `14. admin setwithdrawallimits <min> <max>\n   - Set withdrawal limits.\n\n` +
      `15. admin setdepositlimits <min> <max>\n   - Set deposit limits.\n\n` +
      `16. admin setdepositinfo <M-Pesa_Number> <Name>\n   - Update deposit payment details.\n\n` +
      `[${getKenyaTime()}]\nType the command exactly as shown.`
    );
    return;
  }

  if (command === 'view' && subCommand === 'users') {
    let userList = Object.values(users)
      .map(u => `${u.firstName} ${u.secondName} (Phone: ${u.phone})`)
      .join('\n');
    if (!userList) userList = 'No registered users.';
    await message.reply(`📋 *User List:*\n\n${userList}\n\n[${getKenyaTime()}]`);
    return;
  }
  if (command === 'view' && subCommand === 'investments') {
    let investmentsList = '';
    for (let key in users) {
      let u = users[key];
      u.investments.forEach((inv, idx) => {
        investmentsList += `${u.firstName} ${u.secondName} - Investment ${idx + 1}: Ksh ${inv.amount}, Status: ${inv.status}\n`;
      });
    }
    if (!investmentsList) investmentsList = 'No investments found.';
    await message.reply(`📊 *Investments:*\n\n${investmentsList}\n[${getKenyaTime()}]`);
    return;
  }
  if (command === 'view' && subCommand === 'deposits') {
    let depositsList = '';
    for (let key in users) {
      let u = users[key];
      u.deposits.forEach((dep, idx) => {
        depositsList += `${u.firstName} ${u.secondName} - Deposit ${idx + 1}: ID: ${dep.depositID}, Amount: Ksh ${dep.amount}, Status: ${dep.status}\n`;
      });
    }
    if (!depositsList) depositsList = 'No deposits found.';
    await message.reply(`💰 *Deposits:*\n\n${depositsList}\n[${getKenyaTime()}]`);
    return;
  }
  if (command === 'approve' && subCommand === 'deposit') {
    const depID = msgParts[3];
    if (!depID) {
      await message.reply(`Usage: admin approve deposit <DEP-ID>`);
      return;
    }
    let found = false;
    for (let key in users) {
      let u = users[key];
      u.deposits.forEach(dep => {
        if (dep.depositID.toLowerCase() === depID.toLowerCase()) {
          dep.status = 'approved';
          u.accountBalance += parseFloat(dep.amount);
          found = true;
        }
      });
    }
    if (found) {
      saveUsers();
      await message.reply(`✅ Deposit ${depID} approved! [${getKenyaTime()}]`);
    } else {
      await message.reply(`❌ Deposit ID not found: ${depID}`);
    }
    return;
  }
  if (command === 'reject' && subCommand === 'deposit') {
    const depID = msgParts[3];
    if (!depID) {
      await message.reply(`Usage: admin reject deposit <DEP-ID> <Reason>`);
      return;
    }
    const reason = msgParts.slice(4).join(' ') || 'No reason given';
    let found = false;
    for (let key in users) {
      let u = users[key];
      u.deposits.forEach(dep => {
        if (dep.depositID.toLowerCase() === depID.toLowerCase()) {
          dep.status = `rejected (${reason})`;
          found = true;
        }
      });
    }
    if (found) {
      saveUsers();
      await message.reply(`❌ Deposit ${depID} rejected. Reason: ${reason}\n[${getKenyaTime()}]`);
    } else {
      await message.reply(`Deposit ID not found: ${depID}`);
    }
    return;
  }
  if (command === 'approve' && subCommand === 'withdrawal') {
    const wdID = msgParts[3];
    if (!wdID) {
      await message.reply(`Usage: admin approve withdrawal <WD-ID>`);
      return;
    }
    let found = false;
    for (let key in users) {
      let u = users[key];
      u.withdrawals.forEach(wd => {
        if (wd.withdrawalID.toLowerCase() === wdID.toLowerCase()) {
          wd.status = 'approved';
          found = true;
        }
      });
    }
    if (found) {
      saveUsers();
      await message.reply(`✅ Withdrawal ${wdID} approved!\n[${getKenyaTime()}]`);
    } else {
      await message.reply(`❌ Withdrawal ID not found: ${wdID}`);
    }
    return;
  }
  if (command === 'reject' && subCommand === 'withdrawal') {
    const wdID = msgParts[3];
    if (!wdID) {
      await message.reply(`Usage: admin reject withdrawal <WD-ID> <Reason>`);
      return;
    }
    const reason = msgParts.slice(4).join(' ') || 'No reason given';
    let found = false;
    for (let key in users) {
      let u = users[key];
      u.withdrawals.forEach(wd => {
        if (wd.withdrawalID.toLowerCase() === wdID.toLowerCase()) {
          wd.status = `rejected (${reason})`;
          found = true;
        }
      });
    }
    if (found) {
      saveUsers();
      await message.reply(`❌ Withdrawal ${wdID} rejected. Reason: ${reason}\n[${getKenyaTime()}]`);
    } else {
      await message.reply(`Withdrawal ID not found: ${wdID}`);
    }
    return;
  }
  if (command === 'ban' && subCommand === 'user') {
    let phone = msgParts[3];
    if (!phone) {
      await message.reply(`Usage: admin ban user <phone> <Reason>`);
      return;
    }
    let reason = msgParts.slice(4).join(' ') || 'No reason provided';
    if (users[phone]) {
      if (users[phone].whatsAppId.replace(/\D/g, '') === SUPER_ADMIN) {
        await message.reply(`🚫 Cannot ban the Super Admin!`);
        return;
      }
      users[phone].banned = true;
      saveUsers();
      await message.reply(`🚫 User ${phone} has been banned.\nReason: ${reason}\n[${getKenyaTime()}]`);
    } else {
      await message.reply(`User with phone ${phone} not found.`);
    }
    return;
  }
  if (command === 'add' && subCommand === 'admin') {
    if (chatId.replace(/\D/g, '') !== SUPER_ADMIN) {
      await message.reply(`🚫 Only the Super Admin can add new admins.`);
      return;
    }
    let newAdminPhone = msgParts[3]?.replace(/\D/g, '');
    if (!newAdminPhone) {
      await message.reply(`Usage: admin add admin <phone>`);
      return;
    }
    if (!admins.includes(newAdminPhone)) {
      admins.push(newAdminPhone);
      await message.reply(`✅ ${newAdminPhone} has been added as an admin.`);
    } else {
      await message.reply(`ℹ️ ${newAdminPhone} is already an admin.`);
    }
    return;
  }
  // NEW ADMIN COMMANDS:
  if (command === 'addbalance') {
    // admin addbalance <phone> <amount>
    let phone = msgParts[2];
    let amount = parseFloat(msgParts[3]);
    if (!phone || isNaN(amount)) {
      await message.reply(`Usage: admin addbalance <phone> <amount>`);
      return;
    }
    if (!users[phone]) {
      await message.reply(`User with phone ${phone} not found.`);
      return;
    }
    users[phone].accountBalance += amount;
    saveUsers();
    await message.reply(`✅ Added Ksh ${amount} to user ${phone}. New balance: Ksh ${users[phone].accountBalance}`);
    try {
      await client.sendMessage(users[phone].whatsAppId, `💰 Hi! Your account has been credited with Ksh ${amount}. New balance: Ksh ${users[phone].accountBalance}`);
    } catch (error) {
      console.error(`Error notifying user ${phone}:`, error);
    }
    return;
  }
  if (command === 'deductbalance') {
    // admin deductbalance <phone> <amount>
    let phone = msgParts[2];
    let amount = parseFloat(msgParts[3]);
    if (!phone || isNaN(amount)) {
      await message.reply(`Usage: admin deductbalance <phone> <amount>`);
      return;
    }
    if (!users[phone]) {
      await message.reply(`User with phone ${phone} not found.`);
      return;
    }
    users[phone].accountBalance = Math.max(0, users[phone].accountBalance - amount);
    saveUsers();
    await message.reply(`✅ Deducted Ksh ${amount} from user ${phone}. New balance: Ksh ${users[phone].accountBalance}`);
    try {
      await client.sendMessage(users[phone].whatsAppId, `⚠️ Ksh ${amount} has been deducted from your account. New balance: Ksh ${users[phone].accountBalance}`);
    } catch (error) {
      console.error(`Error notifying user ${phone}:`, error);
    }
    return;
  }
  if (command === 'unban') {
    // admin unban <phone>
    let phone = msgParts[2];
    if (!phone) {
      await message.reply(`Usage: admin unban <phone>`);
      return;
    }
    if (!users[phone]) {
      await message.reply(`User with phone ${phone} not found.`);
      return;
    }
    users[phone].banned = false;
    saveUsers();
    await message.reply(`✅ User ${phone} has been unbanned.`);
    try {
      await client.sendMessage(users[phone].whatsAppId, `🎉 Good news! You have been unbanned from FY'S INVESTMENT BOT.`);
    } catch (error) {
      console.error(`Error notifying user ${phone}:`, error);
    }
    return;
  }
  if (command === 'setwithdrawallimits') {
    // admin setwithdrawallimits <min> <max>
    let min = parseFloat(msgParts[2]);
    let max = parseFloat(msgParts[3]);
    if (isNaN(min) || isNaN(max)) {
      await message.reply(`Usage: admin setwithdrawallimits <min> <max>`);
      return;
    }
    withdrawalMin = min;
    withdrawalMax = max;
    await message.reply(`✅ Withdrawal limits updated!\nMinimum: Ksh ${withdrawalMin}, Maximum: Ksh ${withdrawalMax}\n[${getKenyaTime()}]`);
    return;
  }
  if (command === 'setdepositlimits') {
    // admin setdepositlimits <min> <max>
    let min = parseFloat(msgParts[2]);
    let max = parseFloat(msgParts[3]);
    if (isNaN(min) || isNaN(max)) {
      await message.reply(`Usage: admin setdepositlimits <min> <max>`);
      return;
    }
    depositMin = min;
    depositMax = max;
    await message.reply(`✅ Deposit limits updated!\nMinimum: Ksh ${depositMin}, Maximum: Ksh ${depositMax}\n[${getKenyaTime()}]`);
    return;
  }
  if (command === 'setdepositinfo') {
    // admin setdepositinfo <M-Pesa_Number> <Name>
    let mpesa = msgParts[2];
    let name = msgParts.slice(3).join(' ');
    if (!mpesa || !name) {
      await message.reply(`Usage: admin setdepositinfo <M-Pesa_Number> <Name>`);
      return;
    }
    depositInfo.number = mpesa;
    depositInfo.name = name;
    await message.reply(`✅ Deposit payment details updated!\nNew Details: ${depositInfo.number} (Name: ${depositInfo.name})\n[${getKenyaTime()}]`);
    return;
  }
  // If no recognized command:
  await message.reply(`❓ Unrecognized admin command. Type "admin CMD" to see all commands.\n[${getKenyaTime()}]`);
}

// ---------------------------
// MAIN MENU HELPER
// ---------------------------
function mainMenuText() {
  return (
    `🌟 *FY'S INVESTMENT BOT Main Menu* 🌟\n` +
    `Current Time: ${getKenyaTime()}\n\n` +
    `Please choose an option:\n` +
    `1. Invest 💰\n` +
    `2. Check Balance 🔍\n` +
    `3. Withdraw Earnings 💸\n` +
    `4. Deposit Funds 💵\n` +
    `5. Change PIN 🔐\n` +
    `6. My Referral Link 🔗\n\n` +
    `Tip: Type "0" to go back or "00" to return to this menu anytime!`
  );
}

// ---------------------------
// START THE WHATSAPP CLIENT
// ---------------------------
client.initialize();
