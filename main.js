/**
 * FY'S INVESTMENT BOT
 *
 * Updated version to minimize multiple messages at once, ignore its own messages,
 * and notify Super Admin on successful connection.
 */

const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

// -----------------------------------
// CONFIG & GLOBALS
// -----------------------------------
const USERS_FILE = path.join(__dirname, 'users.json');

// Super Admin phone (cannot be edited/removed).
// Format: "2547XXXXXXXX" (no plus sign).
const SUPER_ADMIN = '254701339573';

// List of admins (initially only Super Admin).
let admins = [SUPER_ADMIN];

// In-memory sessions to track conversation state.
let sessions = {};

// Load users from file or create empty.
let users = {};
if (fs.existsSync(USERS_FILE)) {
    try {
        users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    } catch (e) {
        console.error('Error reading users file:', e);
        users = {};
    }
}

// Save users to file.
function saveUsers() {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Helper: get Kenya date/time in a nice format
function getKenyaTime() {
    return new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' });
}

// Helper: random string generator
function randomString(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Generate a unique referral code: "FY'S-XXXXX"
function generateReferralCode() {
    return "FY'S-" + randomString(5);
}

// Generate a deposit ID: e.g., DEP-XXXXXXXX
function generateDepositID() {
    return "DEP-" + randomString(8);
}

// Generate a withdrawal ID: e.g., WD-XXXX
function generateWithdrawalID() {
    return "WD-" + randomString(4);
}

// Helper: check if user is an admin
function isAdmin(chatId) {
    // Remove non-digits from chatId to compare with our stored phone format
    let cleanId = chatId.replace(/\D/g, '');
    return admins.includes(cleanId);
}

// -----------------------------------
// WHATSAPP CLIENT
// -----------------------------------
const client = new Client();

// Display QR code in terminal for authentication
client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
    console.log('Scan the QR code above with your WhatsApp mobile app.');
});

// On ready, notify in terminal and send a message to Super Admin
client.on('ready', async () => {
    console.log(`✅ Client is ready! [${getKenyaTime()}]`);

    // Notify Super Admin
    // In whatsapp-web.js, phone number "2547XXXXXXXX" becomes "2547XXXXXXXX@c.us"
    const superAdminWID = `${SUPER_ADMIN}@c.us`;
    try {
        await client.sendMessage(superAdminWID, `Hello Super Admin! FY'S INVESTMENT BOT is now connected and ready. 🎉\n[${getKenyaTime()}]`);
    } catch (error) {
        console.error('Error sending message to Super Admin:', error);
    }
});

// Listen to all incoming messages, but ignore the bot's own messages
client.on('message_create', async (message) => {
    // Avoid responding to our own messages
    if (message.fromMe) return;

    const chatId = message.from;
    const msgBody = message.body.trim();

    console.log(`[${getKenyaTime()}] Message from ${chatId}: ${msgBody}`);

    // Quick navigation:
    if (msgBody === '00') {
        sessions[chatId] = { state: 'main_menu' };
        await message.reply(`🏠 Returning to Main Menu:\n${mainMenuText(chatId)}`);
        return;
    } else if (msgBody === '0') {
        sessions[chatId] = { state: 'main_menu' };
        await message.reply(`🔙 Going back to Main Menu:\n${mainMenuText(chatId)}`);
        return;
    }

    // Admin commands if user is admin
    if (msgBody.startsWith('admin') && isAdmin(chatId)) {
        await processAdminCommand(message);
        return;
    }

    // Check if user is registered
    let registeredUser = Object.values(users).find(u => u.whatsAppId === chatId);
    if (!sessions[chatId]) {
        sessions[chatId] = { state: registeredUser ? 'main_menu' : 'start' };
    }
    let session = sessions[chatId];

    // If user not registered, handle registration
    if (!registeredUser) {
        await handleRegistration(message, session);
    } else {
        // If user is banned, do not proceed
        if (registeredUser.banned) {
            await message.reply(`🚫 You have been banned from using this service.`);
            return;
        }
        // Otherwise, handle user session
        await handleUserSession(message, session, registeredUser);
    }
});

// -----------------------------------
// REGISTRATION HANDLER
// -----------------------------------
async function handleRegistration(message, session) {
    const chatId = message.from;
    const msgBody = message.body.trim();

    switch (session.state) {
        case 'start':
            // Send a single welcome message
            await message.reply(
                `👋 Hello! Welcome to FY'S INVESTMENT BOT 😊\n` +
                `Please enter your *first name* to continue.`
            );
            session.state = 'awaiting_first_name';
            break;

        case 'awaiting_first_name':
            session.firstName = msgBody;
            // Wait 2 seconds, then ask for second name
            setTimeout(async () => {
                await message.reply(`Great, ${session.firstName}! Now, please enter your *second name*:`);
                session.state = 'awaiting_second_name';
            }, 2000);
            break;

        case 'awaiting_second_name':
            session.secondName = msgBody;
            // Ask for referral code in a single message
            await message.reply(
                `Thanks, ${session.firstName} ${session.secondName}!\n` +
                `If you have a *referral code*, type it now. Otherwise type *NONE*.`
            );
            session.state = 'awaiting_referral_code';
            break;

        case 'awaiting_referral_code': {
            const code = msgBody.toUpperCase();
            if (code !== 'NONE') {
                let referrer = Object.values(users).find(u => u.referralCode === code);
                if (referrer) {
                    session.referredBy = referrer.whatsAppId;
                    // Combine acceptance + next prompt
                    await message.reply(
                        `👍 Referral code accepted!\n` +
                        `Now, please enter your phone number (start with 070 or 01, 10 digits total).`
                    );
                } else {
                    await message.reply(
                        `⚠️ Referral code not found. We will continue without a referral.\n` +
                        `Please enter your phone number (start with 070 or 01, 10 digits total).`
                    );
                }
            } else {
                await message.reply(
                    `No referral code entered. Alright!\n` +
                    `Please enter your phone number (start with 070 or 01, 10 digits total).`
                );
            }
            session.state = 'awaiting_phone';
            break;
        }

        case 'awaiting_phone':
            if (!/^(070|01)\d{7}$/.test(msgBody)) {
                await message.reply(
                    `❌ Invalid phone number format. It must start with 070 or 01 and be exactly 10 digits.\n` +
                    `Please re-enter your phone number.`
                );
            } else {
                session.phone = msgBody;
                await message.reply(
                    `Now, please create a *4-digit PIN* for your withdrawals (from referral earnings).`
                );
                session.state = 'awaiting_withdrawal_pin';
            }
            break;

        case 'awaiting_withdrawal_pin':
            if (!/^\d{4}$/.test(msgBody)) {
                await message.reply(`❌ Invalid PIN. Please enter a *4-digit* PIN:`);
            } else {
                session.withdrawalPIN = msgBody;
                await message.reply(
                    `Almost done! Please create a *4-digit security PIN* (re-entry after 30 minutes of inactivity).`
                );
                session.state = 'awaiting_security_pin';
            }
            break;

        case 'awaiting_security_pin':
            if (!/^\d{4}$/.test(msgBody)) {
                await message.reply(`❌ Invalid PIN. Please enter a *4-digit* security PIN:`);
            } else {
                session.securityPIN = msgBody;

                // Create new user record
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

                // Use phone as the key
                users[session.phone] = newUser;
                saveUsers();

                await message.reply(
                    `✅ Registration successful, ${newUser.firstName}!\n` +
                    `Your referral code is *${newUser.referralCode}*.\n` +
                    `[${getKenyaTime()}]\n\n` +
                    mainMenuText(chatId)
                );

                // Move to main menu
                sessions[chatId] = { state: 'main_menu' };
            }
            break;

        default:
            // Reset to start if something goes wrong
            await message.reply(`Something went wrong. Let's start over.`);
            session.state = 'start';
            break;
    }
}

// -----------------------------------
// USER SESSION HANDLER
// -----------------------------------
async function handleUserSession(message, session, user) {
    const chatId = message.from;
    const msgBody = message.body.trim();

    switch (session.state) {
        case 'main_menu':
            await message.reply(mainMenuText(chatId));
            session.state = 'awaiting_menu_selection';
            break;

        case 'awaiting_menu_selection':
            switch (msgBody) {
                case '1': // Invest
                    session.state = 'invest';
                    await message.reply(`💰 Enter the *investment amount* (min Ksh 1,000, max Ksh 150,000):`);
                    break;
                case '2': // Check Balance
                    session.state = 'check_balance_menu';
                    await message.reply(
                        `🔍 *Check Balance* Options:\n` +
                        `1. Account Balance\n` +
                        `2. Referral Earnings\n` +
                        `3. Investment History\n` +
                        `Reply with 1, 2, or 3:`
                    );
                    break;
                case '3': // Withdraw
                    session.state = 'withdraw';
                    await message.reply(`💸 Enter the amount to withdraw from your referral earnings (min Ksh 1,000):`);
                    break;
                case '4': // Deposit
                    session.state = 'deposit';
                    await message.reply(`💵 Enter the *deposit amount*:`);
                    break;
                case '5': // Change PIN
                    session.state = 'change_pin';
                    await message.reply(`🔑 To change your PIN, please enter your current 4-digit PIN:`);
                    break;
                default:
                    await message.reply(
                        `❓ Invalid selection. Please choose a valid option.\n` + 
                        mainMenuText(chatId)
                    );
                    break;
            }
            break;

        case 'invest': {
            let amount = parseFloat(msgBody);
            if (isNaN(amount) || amount < 1000 || amount > 150000) {
                await message.reply(`❌ Invalid amount. Enter an amount between Ksh 1,000 and Ksh 150,000:`);
            } else if (user.accountBalance < amount) {
                await message.reply(
                    `⚠️ Insufficient account balance (Ksh ${user.accountBalance}).\n` +
                    `Please deposit funds first.\n\n` +
                    mainMenuText(chatId)
                );
                session.state = 'main_menu';
            } else {
                session.investAmount = amount;
                session.state = 'confirm_investment';
                await message.reply(`Please enter your 4-digit PIN to confirm the investment of Ksh ${amount}:`);
            }
            break;
        }

        case 'confirm_investment':
            if (msgBody !== user.withdrawalPIN) {
                await message.reply(`❌ Incorrect PIN. Try again or type 0 to cancel.`);
            } else {
                // Deduct from balance
                user.accountBalance -= session.investAmount;
                let investment = {
                    amount: session.investAmount,
                    date: getKenyaTime(),
                    expectedReturn: (session.investAmount * 0.10).toFixed(2),
                    status: 'active'
                };
                user.investments.push(investment);

                // If first investment & user was referred, add referral bonus
                if (user.investments.length === 1 && user.referredBy) {
                    let referrer = Object.values(users).find(u => u.whatsAppId === user.referredBy);
                    if (referrer) {
                        let bonus = session.investAmount * 0.03;
                        referrer.referralEarnings += bonus;
                        referrer.referrals.push(user.phone);
                        // In production, you might message the referrer about the bonus:
                        console.log(
                            `📢 [${getKenyaTime()}] Referral bonus: ` +
                            `${referrer.firstName} earned Ksh ${bonus} from ${user.firstName}'s investment.`
                        );
                    }
                }

                saveUsers();
                await message.reply(
                    `✅ Investment confirmed!\n` +
                    `Amount: Ksh ${session.investAmount}\n` +
                    `Expected Return (10% after 24hrs): Ksh ${investment.expectedReturn}\n` +
                    `[${getKenyaTime()}]\n\n` +
                    mainMenuText(chatId)
                );
                session.state = 'main_menu';
            }
            break;

        case 'check_balance_menu':
            switch (msgBody) {
                case '1':
                    await message.reply(
                        `💳 Your Account Balance: Ksh ${user.accountBalance}\n` +
                        `[${getKenyaTime()}]\n\n` +
                        mainMenuText(chatId)
                    );
                    session.state = 'main_menu';
                    break;
                case '2':
                    await message.reply(
                        `🎉 Your Referral Earnings: Ksh ${user.referralEarnings}\n` +
                        `[${getKenyaTime()}]\n\n` +
                        mainMenuText(chatId)
                    );
                    session.state = 'main_menu';
                    break;
                case '3':
                    if (user.investments.length === 0) {
                        await message.reply(
                            `📄 You have no investments yet.\n` +
                            `[${getKenyaTime()}]\n\n` +
                            mainMenuText(chatId)
                        );
                    } else {
                        let history = user.investments.map((inv, i) =>
                            `${i + 1}. Amount: Ksh ${inv.amount}, Return: Ksh ${inv.expectedReturn}, Date: ${inv.date}, Status: ${inv.status}`
                        ).join('\n');
                        await message.reply(
                            `📊 Investment History:\n${history}\n[${getKenyaTime()}]\n\n` +
                            mainMenuText(chatId)
                        );
                    }
                    session.state = 'main_menu';
                    break;
                default:
                    await message.reply(`❓ Invalid selection. Please choose 1, 2, or 3.`);
                    break;
            }
            break;

        case 'withdraw': {
            let amount = parseFloat(msgBody);
            if (isNaN(amount) || amount < 1000) {
                await message.reply(`❌ Invalid amount. Withdrawal must be at least Ksh 1,000:`);
            } else if (user.referralEarnings < amount) {
                await message.reply(
                    `⚠️ Insufficient referral earnings (Ksh ${user.referralEarnings}).\n` +
                    mainMenuText(chatId)
                );
                session.state = 'main_menu';
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
                    `✅ Withdrawal request received.\n` +
                    `Withdrawal ID: ${wd.withdrawalID}\n` +
                    `Amount: Ksh ${amount}\n` +
                    `Status: Under review\n[${getKenyaTime()}]\n\n` +
                    mainMenuText(chatId)
                );
                session.state = 'main_menu';
            }
            break;
        }

        case 'deposit': {
            let amount = parseFloat(msgBody);
            if (isNaN(amount) || amount <= 0) {
                await message.reply(`❌ Invalid deposit amount. Please enter a valid number:`);
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
                    `💵 Please make payment to *M-Pesa 0701339573*, Name: *Camlus Okoth*.\n` +
                    `Your deposit request:\n` +
                    `Deposit ID: ${dep.depositID}\n` +
                    `Amount: Ksh ${amount}\n` +
                    `Status: Under review\n[${getKenyaTime()}]\n\n` +
                    mainMenuText(chatId)
                );
                session.state = 'main_menu';
            }
            break;
        }

        case 'change_pin':
            if (msgBody !== user.withdrawalPIN) {
                await message.reply(`❌ Incorrect current PIN. Please try again or type 0 to cancel.`);
            } else {
                session.state = 'new_pin';
                await message.reply(`🔑 Please enter your *new 4-digit PIN*:`);
            }
            break;

        case 'new_pin':
            if (!/^\d{4}$/.test(msgBody)) {
                await message.reply(`❌ Invalid PIN. Please enter a *4-digit* PIN:`);
            } else {
                user.withdrawalPIN = msgBody;
                saveUsers();
                await message.reply(
                    `✅ PIN changed successfully!\n[${getKenyaTime()}]\n\n` +
                    mainMenuText(chatId)
                );
                session.state = 'main_menu';
            }
            break;

        default:
            // If unrecognized state, show main menu again
            session.state = 'main_menu';
            await message.reply(mainMenuText(chatId));
            break;
    }
}

// -----------------------------------
// ADMIN COMMAND PROCESSOR
// -----------------------------------
async function processAdminCommand(message) {
    const chatId = message.from;
    const msgBody = message.body.trim().split(' ');
    const command = msgBody[1];
    const subCommand = msgBody[2];

    // e.g. admin view users
    if (command === 'view' && subCommand === 'users') {
        let userList = Object.values(users)
            .map(u => `${u.firstName} ${u.secondName} (Phone: ${u.phone})`)
            .join('\n');
        if (!userList) userList = 'No registered users.';
        await message.reply(`📋 *User List:*\n${userList}\n[${getKenyaTime()}]`);
        return;
    }

    // e.g. admin view investments
    if (command === 'view' && subCommand === 'investments') {
        let investmentsList = '';
        for (let key in users) {
            let u = users[key];
            u.investments.forEach((inv, idx) => {
                investmentsList += `${u.firstName} ${u.secondName} - Investment ${idx + 1}: Ksh ${inv.amount}, Status: ${inv.status}\n`;
            });
        }
        if (!investmentsList) investmentsList = 'No investments found.';
        await message.reply(`📊 *All Investments:*\n${investmentsList}\n[${getKenyaTime()}]`);
        return;
    }

    // e.g. admin approve withdrawal WD-XXXX
    if (command === 'approve' && subCommand === 'withdrawal') {
        const withdrawalID = msgBody[3];
        let found = false;
        for (let key in users) {
            let u = users[key];
            u.withdrawals.forEach(wd => {
                if (wd.withdrawalID === withdrawalID) {
                    wd.status = 'approved';
                    found = true;
                }
            });
        }
        if (found) {
            saveUsers();
            await message.reply(`✅ Withdrawal ${withdrawalID} approved.\n[${getKenyaTime()}]`);
        } else {
            await message.reply(`❌ Withdrawal ID not found.`);
        }
        return;
    }

    // e.g. admin reject withdrawal WD-XXXX <Reason...>
    if (command === 'reject' && subCommand === 'withdrawal') {
        const withdrawalID = msgBody[3];
        const reason = msgBody.slice(4).join(' ') || 'No reason given';
        let found = false;
        for (let key in users) {
            let u = users[key];
            u.withdrawals.forEach(wd => {
                if (wd.withdrawalID === withdrawalID) {
                    wd.status = `rejected (${reason})`;
                    found = true;
                }
            });
        }
        if (found) {
            saveUsers();
            await message.reply(`❌ Withdrawal ${withdrawalID} rejected. Reason: ${reason}\n[${getKenyaTime()}]`);
        } else {
            await message.reply(`Withdrawal ID not found.`);
        }
        return;
    }

    // e.g. admin ban user 0701234567 <Reason...>
    if (command === 'ban' && subCommand === 'user') {
        let phone = msgBody[3];
        let reason = msgBody.slice(4).join(' ') || 'No reason provided';
        if (users[phone]) {
            // Do not ban super admin
            if (users[phone].whatsAppId.replace(/\D/g, '') === SUPER_ADMIN) {
                await message.reply(`🚫 You cannot ban the Super Admin.`);
                return;
            }
            users[phone].banned = true;
            saveUsers();
            await message.reply(`🚫 User with phone ${phone} has been banned.\nReason: ${reason}\n[${getKenyaTime()}]`);
        } else {
            await message.reply(`User with phone ${phone} not found.`);
        }
        return;
    }

    // e.g. admin add admin 254712345678
    if (command === 'add' && subCommand === 'admin') {
        // Only Super Admin can add new admins
        if (chatId.replace(/\D/g, '') !== SUPER_ADMIN) {
            await message.reply(`🚫 Only the Super Admin can add new admins.`);
            return;
        }
        let newAdminPhone = msgBody[3].replace(/\D/g, '');
        if (!newAdminPhone) {
            await message.reply(`❌ Invalid phone number for new admin.`);
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

    // If no recognized admin command:
    await message.reply(`❓ Unrecognized admin command.\n[${getKenyaTime()}]`);
}

// -----------------------------------
// MAIN MENU HELPER
// -----------------------------------
function mainMenuText(chatId) {
    return (
        `🌟 *FY'S INVESTMENT BOT* 🌟\n` +
        `[${getKenyaTime()}]\n` +
        `Please select an option:\n` +
        `1. Invest 💰\n` +
        `2. Check Balance 🔍\n` +
        `3. Withdraw Earnings 💸\n` +
        `4. Deposit Funds 💵\n` +
        `5. Change PIN 🔑\n` +
        `\nType *00* for Main Menu or *0* to go back.`
    );
}

// -----------------------------------
// START THE CLIENT
// -----------------------------------
client.initialize();

