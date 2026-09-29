import XLSX from 'xlsx'

const data = [
  ['recipient_first_name', 'recipient_last_name', 'email', 'contact_number', 'transaction_id', 'transaction_type', 'transaction_date', 'participant_type', 'city', 'state'],
  ['John', 'Smith', 'john.smith@example.com', '555-0101', 'TXN-10001', 'Purchase', '2026-09-28', 'BORROWER', 'Austin', 'TX'],
  ['Sarah', 'Johnson', 'sarah.johnson@example.com', '555-0102', 'TXN-10002', 'Refinance', '2026-09-27', 'CO_BORROWER', 'Dallas', 'TX'],
  ['Michael', 'Chen', 'michael.chen@example.com', '555-0103', 'TXN-10003', 'Purchase', '2026-09-26', 'BORROWER', 'Houston', 'TX'],
  ['Jennifer', 'Williams', 'jennifer.williams@example.com', '555-0104', 'TXN-10004', 'Refinance', '2026-09-25', 'BORROWER', 'San Antonio', 'TX'],
  ['David', 'Rodriguez', 'david.rodriguez@example.com', '555-0105', 'TXN-10005', 'Purchase', '2026-09-24', 'CO_BORROWER', 'Fort Worth', 'TX'],
  ['Emily', 'Brown', 'emily.brown@example.com', '555-0106', 'TXN-10006', 'Refinance', '2026-09-23', 'BORROWER', 'Phoenix', 'AZ'],
  ['Robert', 'Martinez', 'robert.martinez@example.com', '555-0107', 'TXN-10007', 'Purchase', '2026-09-22', 'BORROWER', 'Mesa', 'AZ'],
  ['Lisa', 'Anderson', 'lisa.anderson@example.com', '555-0108', 'TXN-10008', 'Refinance', '2026-09-21', 'CO_BORROWER', 'Chandler', 'AZ'],
  ['James', 'Taylor', 'james.taylor@example.com', '555-0109', 'TXN-10009', 'Purchase', '2026-09-20', 'BORROWER', 'Tampa', 'FL'],
  ['Patricia', 'Thomas', 'patricia.thomas@example.com', '555-0110', 'TXN-10010', 'Refinance', '2026-09-19', 'BORROWER', 'Orlando', 'FL'],
]

const ws = XLSX.utils.aoa_to_sheet(data)
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, ws, 'Recipients')
XLSX.writeFile(wb, 'test-recipients.xlsx')
console.log('✓ Created test-recipients.xlsx')
