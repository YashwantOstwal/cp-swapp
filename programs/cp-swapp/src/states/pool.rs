use anchor_lang::prelude::*;
use crate::constants::{SWAP_FEES_DENOMINATION};
#[account]
#[derive(InitSpace)]
pub struct Pool{
    pub mint_a:Pubkey,
    pub mint_b:Pubkey,
    pub fees_in_ppm:u32,
    pub bump:u8,
}

impl Pool {
    pub fn swap_fees(&self,net_input_amount:u64)-> u64 {
        let dividend = u128::from(net_input_amount).checked_mul(self.fees_in_ppm.into()).unwrap().checked_div(SWAP_FEES_DENOMINATION.into()).unwrap();
        let remainder = u128::from(net_input_amount).checked_mul(self.fees_in_ppm.into()).unwrap().checked_rem(SWAP_FEES_DENOMINATION.into()).unwrap();

        let mut swap_fees = dividend;
        if remainder > 0 {
            swap_fees+=1;
        }
        u64::try_from(swap_fees).unwrap()
    }
}