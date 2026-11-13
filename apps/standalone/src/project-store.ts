import {openHistoryStore} from '@brickwright/cad-history';
export const historyStore=openHistoryStore();
void historyStore.catch(()=>{});
