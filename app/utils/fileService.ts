import { YNABTransaction } from './ynabService';

export class FileService {
  async convertFile(file: File): Promise<YNABTransaction[]> {
    const text = await file.text();
    const lines = text.split('\n');
    
    // Skip header row
    const dataRows = lines.slice(1);
    
    return dataRows.map(row => {
      const [date, payee, memo, amount] = row.split(',');
      return {
        date,
        payee_name: payee,
        memo,
        amount: parseFloat(amount) * 1000, // Convert to milliunits
        cleared: 'cleared',
        account_id: '', // This will be set later in YNABIntegration
        approved: false,
      };
    });
  }
}

export const fileService = new FileService(); 