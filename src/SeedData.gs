/**
 * SentiPulse - SeedData.gs
 * Adds dummy feedback (backdated over 8 weeks) so the dashboard has a story.
 * All names and events are fictional.
 */

const SEED_FLAG = 'SEED_DATA_ADDED';
const SEED_OFFSET = '+08:00';          // Asia/Manila has no daylight saving

// [days ago, 'HH:MM' Manila time, category, rating, feedback]
const SEED_ROWS = [
  // ---- Week 1: normal days ----
  [56, '09:15', 'Product Quality', 5, 'The Spanish latte at the Makati branch is perfect. Rich, not too sweet. My new favorite!'],
  [55, '14:40', 'Customer Service', 5, 'Barista Migs remembered my order from last week. Super friendly, made my morning.'],
  [55, '19:05', 'Pricing', 3, 'Good coffee but 220 pesos for a cold brew is a bit steep for students like us.'],
  [54, '11:20', 'Overall Experience', 4, 'Cozy place, good music, strong Wi-Fi. Perfect for working. Seats fill up fast though.'],
  [53, '16:30', 'Product Quality', 2, 'My flat white tasted burnt and bitter. Hindi na ako babalik sa branch na ito unless mag-improve sila.'],
  [52, '10:10', 'Other', 4, 'Clean restrooms and nice plants everywhere. Parking is hard to find around Pasig though.'],
  [51, '13:25', 'Product Quality', 5, 'Ang sarap ng ube latte! Hindi sobrang tamis, tamang-tama lang. Babalik ako for sure.'],
  [50, '18:45', 'Customer Service', 3, 'Order was ready in 10 minutes, nothing special. Staff was polite but did not smile much.'],

  // ---- Week 2 ----
  [49, '08:50', 'Product Quality', 5, 'Best barako blend I have tried outside of Batangas. Strong and smooth.'],
  [48, '12:15', 'Website/App', 4, 'Pre-ordering through the app saved me 15 minutes. The loyalty points feature is nice.'],
  [47, '15:30', 'Pricing', 3, 'Pastries are reasonably priced and fresh. The croissant is flaky and buttery.'],
  [46, '09:40', 'Customer Service', 1, 'Waited 25 minutes for one cappuccino while staff were chatting. Nobody apologized when I asked.'],
  [46, '20:10', 'Overall Experience', 5, 'We celebrated our anniversary here. The staff surprised us with a free dessert. Thank you!'],
  [45, '11:00', 'Delivery', 4, 'Beans arrived in 2 days, well packed, and still smell amazing. Will reorder.'],
  [44, '17:20', 'Product Quality', 3, 'Okay lang ang cold brew, medyo matubig. Ang ensaymada naman ang sarap.'],
  [43, '13:35', 'Other', 3, 'The branch was clean but the air conditioning was too cold. Will bring a jacket next time.'],

  // ---- Week 3 ----
  [42, '10:05', 'Product Quality', 5, 'Fresh roasted aroma hits you the moment you walk in. The Kanto house blend is superb.'],
  [41, '14:50', 'Customer Service', 5, 'The manager personally helped me pick beans for my French press. Great service!'],
  [41, '19:30', 'Pricing', 2, 'Prices went up again and the drink sizes look smaller. Not worth it anymore.'],
  [40, '08:25', 'Website/App', 3, 'App works fine but loyalty points sometimes take a day to show up.'],
  [39, '12:45', 'Overall Experience', 4, 'Nice ambiance and good coffee. The pastry selection was limited after 6 pm.'],
  [38, '16:10', 'Product Quality', 5, 'The pistachio croissant is dangerous. I buy two every time. 10 out of 10.'],
  [37, '11:55', 'Delivery', 5, 'Next day delivery and the courier was very polite. Coffee bag was sealed perfectly.'],
  [36, '18:15', 'Customer Service', 4, 'Mabilis ang service at ang bait ng cashier. Sana lang may more seats sa Quezon City branch.'],

  // ---- Week 4 ----
  [35, '09:30', 'Product Quality', 5, 'Cold brew is smooth and strong. Perfect for hot Manila afternoons.'],
  [34, '13:10', 'Other', 5, 'Love the new reading corner. The staff even lent me a charger. Thanks!'],
  [33, '15:45', 'Pricing', 3, 'The combo meal is a good deal but the add-on prices are expensive.'],
  [33, '20:00', 'Customer Service', 2, 'My order was wrong twice. I asked for oat milk and got regular milk both times.'],
  [32, '10:20', 'Website/App', 5, 'Super smooth checkout and I got a free drink with my points. Love the app!'],
  [31, '12:30', 'Delivery', 4, 'Order arrived on time. The box was a little dented but the beans were fine.'],
  [30, '17:05', 'Overall Experience', 5, 'Our favorite weekend spot. Kids love the hot chocolate and we love the espresso.'],
  [29, '14:20', 'Product Quality', 3, 'Medyo mapait ang espresso ngayon pero okay pa rin ang pastries. Sana consistent lagi.'],

  // ---- Week 5: the delivery crisis ----
  [28, '09:50', 'Delivery', 1, 'Ordered beans on Monday and it is already Friday. No updates, no tracking, and nobody answers my messages.'],
  [27, '14:15', 'Delivery', 2, 'Courier delayed by 4 days. The beans are fine but I needed them for a gift. Very disappointing.'],
  [27, '19:40', 'Delivery', 1, 'Package arrived soaked from the rain and one bag was torn. I want a refund, not an apology.'],
  [26, '11:25', 'Delivery', 1, 'Ang tagal ng delivery, 6 days na! Kapag ganito lagi, lilipat na ako sa ibang roaster.'],
  [25, '16:05', 'Delivery', 2, 'Tracking number does not work. Customer support just said wait lang daw. Frustrating.'],
  [24, '10:35', 'Delivery', 3, 'Beans arrived 3 days late but the shop gave me a discount code, which was nice.'],
  [23, '13:55', 'Product Quality', 5, 'Despite the delivery problems others have had, my in-store flat white is still the best in Makati.'],
  [22, '18:30', 'Delivery', 1, 'Third late delivery this month. The courier left the parcel with a stranger. Not acceptable.'],

  // ---- Week 6: the app update crashes ----
  [21, '09:20', 'Website/App', 1, 'The new app update keeps crashing every time I open the cart. Cannot order anything.'],
  [20, '12:10', 'Website/App', 2, 'App freezes at checkout and I lost my loyalty points balance after reinstalling.'],
  [20, '20:05', 'Website/App', 1, 'I got charged twice for the same order in the app, 480 pesos each. Please refund the extra charge immediately.'],
  [19, '15:25', 'Website/App', 2, 'Crashing app again. Nag-update ako kagabi tapos hindi na ako makapag-login. Ayusin niyo po.'],
  [18, '10:45', 'Customer Service', 4, 'The barista helped me order in person since the app was down. Thank you for being patient!'],
  [17, '14:00', 'Website/App', 3, 'App is a bit better today but still slow when loading the menu. Hopefully fixed soon.'],
  [16, '11:35', 'Product Quality', 5, 'Tried the new caramel macchiato and I am obsessed. Perfectly balanced.'],
  [15, '19:20', 'Website/App', 2, 'Promo code would not apply and the app showed a blank screen. Went to the counter instead.'],

  // ---- Week 7: recovery, and two serious incidents ----
  [14, '09:10', 'Website/App', 4, 'App is working again and the new menu layout is nicer. Thank you for the fix!'],
  [13, '13:40', 'Product Quality', 1, 'I have a nut allergy and told the barista twice. My drink still had almond milk. I felt my throat itch and had to leave. This is dangerous.'],
  [13, '18:10', 'Customer Service', 1, 'The shift lead raised his voice at me in front of other customers when I asked for a remake. Very rude and unprofessional.'],
  [12, '10:30', 'Delivery', 4, 'Delivery was on time this week. Much better than last month. Packaging was great.'],
  [11, '15:15', 'Overall Experience', 5, 'Always a joy to come here. The team, the coffee, the vibe. Please never change!'],
  [10, '12:20', 'Pricing', 4, 'Loyalty rewards are generous. I got a free pastry after five drinks. Worth it.'],
  [9, '17:45', 'Product Quality', 3, 'Masarap ang kape pero kulang sa laman ang sandwich. For 250 pesos, dapat mas marami.'],
  [8, '08:55', 'Other', 4, 'Great place to study. The only issue is the noisy espresso machine near the window seats.'],

  // ---- Week 8 ----
  [7, '14:10', 'Product Quality', 1, 'I found a hair in my croissant and the staff just replaced it without saying sorry. I feel sick about eating there again.'],
  [6, '11:45', 'Customer Service', 5, 'Thank you to the Pasig team for fixing my wrong order so fast. You turned my bad morning around.'],
  [5, '16:35', 'Delivery', 5, 'Fast delivery, well-sealed bag, and a handwritten thank-you note. These small things matter!'],
  [4, '10:00', 'Overall Experience', 4, 'Good as always. Four stars because the queue was long, but the coffee was worth the wait.']
];

/** Run ONCE by hand: adds the dummy feedback to the Responses tab. */
function seedTestData() {
  const fn = 'seedTestData';
  const props = PropertiesService.getScriptProperties();
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    logEvent_('WARN', fn, 'Another run is busy. Try again in a minute.');
    return;
  }

  try {
    const already = props.getProperty(SEED_FLAG);
    if (already) {
      logEvent_('WARN', fn, 'Seed data was already added on ' + already + '. Nothing was added.');
      return;
    }

    const check = validateSheets_();
    if (!check.ok) {
      logEvent_('CRITICAL', fn, 'Setup check failed, seed data NOT added', check.problems.join(' | '));
      return;
    }

    const sheet = getSheet_(SHEET_NAMES.RESPONSES);
    const now = new Date().getTime();

    const rows = SEED_ROWS.map(function (r) {
      const day = Utilities.formatDate(new Date(now - r[0] * 86400000), 'Asia/Manila', 'yyyy-MM-dd');
      const when = new Date(day + 'T' + r[1] + ':00' + SEED_OFFSET);
      return [when, r[2], r[3], r[4], ''];
    });

    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, 5).setValues(rows);
    sheet.getRange(startRow, 1, rows.length, 1).setNumberFormat('m/d/yyyy h:mm:ss');

    props.setProperty(SEED_FLAG, Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy-MM-dd HH:mm'));
    logEvent_('INFO', fn, rows.length + ' seed feedbacks added to Responses',
      'Rows ' + startRow + ' to ' + (startRow + rows.length - 1) + '. Now run processNow until nothing is Pending.');
  } catch (e) {
    logEvent_('ERROR', fn, 'Seeding failed', e);
  } finally {
    lock.releaseLock();
  }
}

/** Run by hand any time: shows how far the processing is. */
function showProgress() {
  const fn = 'showProgress';
  const responseRows = Math.max(0, getSheet_(SHEET_NAMES.RESPONSES).getLastRow() - 1);
  const analysis = getSheet_(SHEET_NAMES.ANALYSIS);
  const last = analysis.getLastRow();

  const status = { Done: 0, Pending: 0, Failed: 0 };
  const alerts = {};
  if (last >= 2) {
    analysis.getRange(2, 11, last - 1, 5).getValues().forEach(function (row) {
      const s = String(row[0]).trim() || 'Pending';
      status[s] = (status[s] || 0) + 1;
      const a = String(row[4]).trim() || '(empty)';
      alerts[a] = (alerts[a] || 0) + 1;
    });
  }

  const waiting = Math.max(0, responseRows - Math.max(0, last - 1)) + status.Pending;
  logEvent_('INFO', fn, 'Responses: ' + responseRows + ' | Analyzed: ' + status.Done +
    ' | Waiting: ' + waiting + ' | Failed: ' + status.Failed,
    'Alert Sent counts: ' + JSON.stringify(alerts));
}

/** Run by hand: puts every Failed row back in the queue (clears error and retry count). */
function resetFailedRows() {
  const fn = 'resetFailedRows';
  const sheet = getSheet_(SHEET_NAMES.ANALYSIS);
  const last = sheet.getLastRow();
  if (last < 2) { return; }

  const range = sheet.getRange(2, 11, last - 1, 4);   // columns K to N
  const values = range.getValues();
  let count = 0;

  values.forEach(function (row) {
    if (String(row[0]).trim() === 'Failed') {
      row[0] = 'Pending';   // Status
      row[1] = '';          // Processed At
      row[2] = '';          // Error
      row[3] = 0;           // Retry Count
      count++;
    }
  });

  range.setValues(values);
  logEvent_('INFO', fn, count + ' failed row(s) put back in the queue');
}