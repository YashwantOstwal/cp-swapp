use std::char::MAX;

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken, token::Token, token_2022::spl_token_2022::{self,
            extension::{BaseStateWithExtensions, StateWithExtensions, transfer_fee::{MAX_FEE_BASIS_POINTS, TransferFeeConfig}}
        }, token_interface::{
        Mint, TokenAccount, TokenInterface, TransferCheckedWithFee,transfer_checked_with_fee
    }
};

use crate::*;
use crate::error::ErrorCode;


#[derive(Accounts)]
#[instruction(fees_in_ppm:u32)]
pub struct SwapBaseInput<'info>{
    #[account(mut)]
    pub owner:Signer<'info>,

    #[account(
        mint::token_program = input_token_program,
        mint::authority = authority
    )]
    pub input_mint:InterfaceAccount<'info,Mint>,

    #[account(
        mint::token_program = output_token_program,
        mint::authority = authority,
    )]
    pub output_mint:InterfaceAccount<'info,Mint>,

    #[account(
        seeds = [POOL_AUTHORITY.as_bytes(),pool_state.key().as_ref()],
        bump,
    )]
    pub authority: SystemAccount<'info>,

    #[account(
        constraint = (pool_state.mint_a == input_mint.key() && pool_state.mint_b == output_mint.key() ) ||( pool_state.mint_b == input_mint.key() && pool_state.mint_a == output_mint.key() && pool_state.fees_in_ppm == fees_in_ppm)  @ErrorCode::InvalidPool,
    )]
    pool_state:Account<'info,Pool>,

    #[account(
        mut,
        associated_token::mint = input_mint,
        associated_token::authority = owner,
        associated_token::token_program = input_token_program
    )]
    pub owner_input_token:InterfaceAccount<'info,TokenAccount>,

    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = output_mint,
        associated_token::authority = owner,
        associated_token::token_program = output_token_program
    )]
    pub owner_output_token:InterfaceAccount<'info,TokenAccount>,

    #[account(
        mut,
        associated_token::mint = input_mint,
        associated_token::authority = authority,
        associated_token::token_program = input_token_program,
    )]
    pub input_token_vault:InterfaceAccount<'info,TokenAccount>,

    #[account(
        mut,
        associated_token::mint = output_mint,
        associated_token::authority = authority,
        associated_token::token_program = output_token_program
    )]
    pub output_token_vault:InterfaceAccount<'info,TokenAccount>,
    pub system_program:Program<'info,System>,
    pub associated_token_program:Program<'info,AssociatedToken>,
    pub input_token_program:Interface<'info,TokenInterface>,
    pub output_token_program:Interface<'info,TokenInterface>,
    
}

pub fn swap_base_input_handler(ctx:Context<SwapBaseInput>,fees_in_ppm:u32,exact_input_amount:u64,min_output_amount:u64)->Result<()>{

    require_gt!(exact_input_amount,0,ErrorCode::InvalidInputAmount);

    // Calculating the net input amount.
    let input_transfer_fee = get_transfer_fees(&ctx.accounts.input_mint, exact_input_amount)?;
    let net_input_amount = exact_input_amount - input_transfer_fee;

    // Calculate the curve amount, Net input amount - swap fees of the net input amount.
    let pool_state = &ctx.accounts.pool_state;
    let curve_input_amount = net_input_amount - pool_state.swap_fees(net_input_amount);
    require_gt!(curve_input_amount,0,ErrorCode::InvalidInputAmount);

    // Apply curve math, x*y = new_x * new_y where new_x = x + curve_input_amount, new_y = y - curve_output_amount, Find curve_output_amount;
    let x = ctx.accounts.input_token_vault.amount;
    let y = ctx.accounts.output_token_vault.amount;
    let k_before = u128::from(x).checked_mul(y.into()).unwrap();

    let new_x = u128::from(x).checked_add(curve_input_amount.into()).ok_or(ErrorCode::MathOverflow)?;
    let new_y = {

        // Custom ceiling in smart contracts.
        let dividend = u128::from(x).checked_mul(y.into()).ok_or(ErrorCode::MathOverflow)?.checked_div(new_x).ok_or(ErrorCode::MathOverflow)?;
        let remainder = u128::from(x).checked_mul(y.into()).ok_or(ErrorCode::MathOverflow)?.checked_rem(new_x).ok_or(ErrorCode::MathOverflow)?;

        let mut new_y = dividend;
        if remainder > 0 {
            new_y += 1;
        }
        new_y
    };

    // Amount transferred to the user.
    let curve_output_amount = y.checked_sub(u64::try_from(new_y)?).ok_or(ErrorCode::MathOverflow)?;

    let output_transfer_fee = get_transfer_fees(&ctx.accounts.output_mint, curve_output_amount)?;
    let net_output_amount = curve_output_amount - output_transfer_fee;

    // Amount received post tax charged by the mint if owned by token2022 program and has TransferFeeConfig extension enabled.
    require_gte!(net_output_amount,min_output_amount,ErrorCode::FailedToExceedMinimum);

    let transfer_from_user_to_vault_ctx = CpiContext::new(ctx.accounts.input_token_program.key(),TransferCheckedWithFee{
        token_program_id:ctx.accounts.input_token_program.to_account_info(),
        source:ctx.accounts.owner_input_token.to_account_info(),
        destination:ctx.accounts.input_token_vault.to_account_info(),
        mint:ctx.accounts.input_mint.to_account_info(),
        authority:ctx.accounts.owner.to_account_info()
    });

    transfer_checked_with_fee(transfer_from_user_to_vault_ctx, exact_input_amount, ctx.accounts.input_mint.decimals, input_transfer_fee)?;

    let pool_id = ctx.accounts.pool_state.key();
    let pool_authority_seeds: &[&[u8]] = &[POOL_AUTHORITY.as_bytes(),pool_id.as_ref(),&[ctx.bumps.authority]];
    let signer_seeds = &[&pool_authority_seeds[..]];

    let transfer_from_vault_to_user_ctx = CpiContext::new(ctx.accounts.output_token_program.key(),TransferCheckedWithFee{
        token_program_id:ctx.accounts.output_token_program.to_account_info(),
        source:ctx.accounts.output_token_vault.to_account_info(),
        destination:ctx.accounts.owner_input_token.to_account_info(),
        mint:ctx.accounts.output_mint.to_account_info(),
        authority:ctx.accounts.owner.to_account_info()
    }).with_signer(signer_seeds);

    transfer_checked_with_fee(transfer_from_vault_to_user_ctx, curve_output_amount, ctx.accounts.output_mint.decimals, output_transfer_fee)?;

    ctx.accounts.input_token_vault.reload()?;
    ctx.accounts.output_token_vault.reload()?;

    let k_after  = u128::from(ctx.accounts.input_token_vault.amount).checked_mul(ctx.accounts.output_token_vault.amount.into()).ok_or(ErrorCode::MathOverflow)?;

    // new invariant is greater than or equal to the old. This ensures that the pool is never in deficit after a swap.
    require_gte!(k_after,k_before);

    Ok(())
}

pub fn get_transfer_fees(mint:&InterfaceAccount<Mint>,pre_fee_amount:u64)->Result<u64>{
    let mint_info = mint.to_account_info();

    // If owned by token program.
    if *mint_info.owner == Token::id() {
        return Ok(0)
    }
    let mint_data = mint_info.try_borrow_data()?;
    let mint_state = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&mint_data)?;
    if let Ok(transfer_fee_config) = mint_state.get_extension::<TransferFeeConfig>(){
        let current_epoch = Clock::get()?.epoch;
        let transfer_fee = transfer_fee_config.get_epoch_fee(current_epoch);
        // Crucial check....has to do with the underlying formula used to calculate the inverse fee.
        if u16::from(transfer_fee.transfer_fee_basis_points) == MAX_FEE_BASIS_POINTS {
            return Ok(u64::from(transfer_fee.maximum_fee));
        }
        let fee = transfer_fee.calculate_fee(pre_fee_amount).unwrap();
        let fee_check = transfer_fee.calculate_inverse_fee(pre_fee_amount.checked_sub(fee).unwrap()).unwrap();

        // Cross check the fee. There exists two way for us to calculate the transfer fee, one is to calculate the fee directly and the other is to calculate the inverse fee on the post fee amount. Both should yield the same result. If not, we have to error out as something is wrong with the mint's transfer fee configuration.
        if fee != fee_check {
            return err!(ErrorCode::MismatchInTransferFeeCalculation);
        }
        return Ok(fee);
    }

    // token 2022 but no TransferFeeConfig extension enabled.
    return Ok(0)
}