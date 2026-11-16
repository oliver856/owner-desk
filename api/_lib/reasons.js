// Shared by the Hot & cold report (desk.js) and Ask (ask.js), so both count call results the same way.
// The reason behind each call, for the Hot & cold report: [note starts with / 'outcome:' + outcome, label, group]
// group: hot, objection (spoke to them, not interested), nocontact (didn't get through)
export const REASONS = [
  ['Unit available, send WhatsApp', 'Unit available', 'hot'], ['In discussion', 'In discussion', 'hot'], ['Replied', 'Replied', 'hot'],
  ['Follow up', 'Call back', 'hot'], ['Send report', 'Wants a report', 'hot'], ['Wants to sell', 'Wants to sell', 'hot'],
  ['Wants to rent', 'Wants to rent', 'hot'], ['Wants to buy', 'Wants to buy', 'hot'], ['Still looking', 'Still looking (lead)', 'hot'],
  ['Viewing booked', 'Viewing booked (lead)', 'hot'], ['Send options', 'Send options (lead)', 'hot'],
  ['outcome:Call back', 'Call back', 'hot'], ['outcome:Wants valuation', 'Wants valuation', 'hot'],
  ['outcome:Listing opportunity', 'Listing opportunity', 'hot'], ['outcome:Wants to sell', 'Wants to sell', 'hot'],
  ['End user', 'Lives in it (end user)', 'objection'], ['Rented', 'Already rented', 'objection'], ['Sold', 'Already sold', 'objection'],
  ['Agent', 'Agent', 'objection'], ['Other', 'Other (own words)', 'objection'],
  ['Already found', 'Already found (lead)', 'objection'], ['Not looking anymore', 'Not looking anymore (lead)', 'objection'],
  ['Not interested', 'Not interested', 'objection'], ['Not selling yet', 'Not selling yet', 'objection'],
  ['Price too high', 'Price expectations too high', 'objection'], ['Wrong number', 'Wrong number', 'objection'], ['Do not call', 'Do not call', 'objection'],
  ['Wants valuation', 'Wants valuation', 'hot'],
  ['outcome:Not interested', 'Not interested', 'objection'], ['outcome:Wrong number', 'Wrong number', 'objection'],
  ['outcome:Do not call', 'Do not call', 'objection'],
  ['Called, no reply', 'No reply', 'nocontact'], ['Called, unreachable', 'Unreachable', 'nocontact'],
  ['Called, line busy', 'Line busy', 'nocontact'], ['Phone off', 'Phone off', 'nocontact'], ['outcome:No answer', 'No reply', 'nocontact'],
];
