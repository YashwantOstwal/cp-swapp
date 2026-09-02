use anchor_lang::prelude::*;
use anchor_spl::{token::{Token},token_2022::spl_token_2022::{self, extension::{transfer_fee::TransferFeeConfig, BaseStateWithExtensions, StateWithExtensions}}, token_interface::{Mint, TokenAccount, TokenInterface,transfer_checked,TransferChecked}};

use crate::{states::*,error::ErrorCode};

#[derive(Accounts)]
pub struct SwapBaseInput<'info> {

    pub trader: Signer<'info>,

    pub amm_config: Box<Account<'info,AmmConfig>>,

    #[account(
        constraint = (input_mint.key() == pool.mint_0 && output_mint.key() ==  pool.mint_1) || (input_mint.key() == pool.mint_1 && output_mint.key() ==  pool.mint_0) @ ErrorCode::MismatchAccounts
    )]
    pub pool: Account<'info,Pool>,

    #[account(
        mut,
        token::authority = trader,
        token::mint = input_mint,
        token::token_program = input_token_program,
    )]
    pub trader_input_token:InterfaceAccount<'info,TokenAccount>,

    #[account(
        mut,
        associated_token::authority = pool,
        associated_token::mint = input_mint,
        associated_token::token_program = input_token_program,
    )]
    pub input_token_vault:InterfaceAccount<'info,TokenAccount>,

    #[account(
        mint::token_program = input_token_program
    )]
    pub input_mint:InterfaceAccount<'info,Mint>,
    pub input_token_program:Interface<'info,TokenInterface>,

    #[account(
        mut,
        token::authority = trader,
        token::mint = output_mint,
        token::token_program = output_token_program,
    )]
    pub trader_output_token:InterfaceAccount<'info,TokenAccount>,

    #[account(
        mut,
        associated_token::authority = pool,
        associated_token::mint = output_mint,
        associated_token::token_program = output_token_program,
    )]
    pub output_token_vault:InterfaceAccount<'info,TokenAccount>,

    #[account(
        mint::token_program = output_token_program
    )]
    pub output_mint:InterfaceAccount<'info,Mint>,
    pub output_token_program:Interface<'info,TokenInterface>,
}

pub fn handle_swap_base_input(ctx:Context<SwapBaseInput>,exact_input_amount:u64,minimum_output_amount:u64) -> Result<()> {

    let trader_input_token = &ctx.accounts.trader_input_token;
    require!(exact_input_amount <= trader_input_token.amount ,ErrorCode::InsufficientFunds);

    let input_mint = &ctx.accounts.input_mint;
    let net_input_amount = if ctx.accounts.input_token_program.key() == Token::id() {
        exact_input_amount
    }else {
        let input_mint_info = input_mint.to_account_info();
        let input_mint_data = input_mint_info.try_borrow_data()?;
        let input_mint_state = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&input_mint_data)?;
        if let Ok(transfer_fee_config) = input_mint_state.get_extension::<TransferFeeConfig>() {
            let clock = Clock::get()?;
            let transfer_fee = transfer_fee_config.get_epoch_fee(clock.epoch);
            transfer_fee.calculate_post_fee_amount(exact_input_amount).unwrap()
        }else {
            exact_input_amount
        }
    };
    let amm_config = &ctx.accounts.amm_config;
    let curve_input_amount = if amm_config.fee_side_input {
        amm_config.calculate_post_fee_amount(net_input_amount)
    }else {
        net_input_amount
    };

    let x = ctx.accounts.input_token_vault.amount;
    let y = ctx.accounts.output_token_vault.amount;
    let k = x.checked_mul(y).unwrap();
    let curve_output_amount = (y.checked_mul(x.checked_add(curve_input_amount).unwrap()).unwrap().checked_sub(k)).unwrap().checked_div(x.checked_add(curve_input_amount).unwrap()).unwrap();

    let net_output_amount = if !amm_config.fee_side_input {
        amm_config.calculate_post_fee_amount(curve_output_amount)
    }else {
        curve_output_amount
    };

    let output_mint = &ctx.accounts.output_mint;
    let exact_output_amount = if ctx.accounts.output_token_program.key() == Token::id() {
        net_output_amount
    }else {
        let output_mint_info = output_mint.to_account_info();
        let output_mint_data = output_mint_info.try_borrow_data()?;
        let output_mint_state = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&output_mint_data)?;
        if let Ok(transfer_fee_config) = output_mint_state.get_extension::<TransferFeeConfig>() {
            let clock = Clock::get()?;
            let transfer_fee = transfer_fee_config.get_epoch_fee(clock.epoch);
            transfer_fee.calculate_post_fee_amount(net_output_amount).unwrap()
        }else {
            net_output_amount
        }
    };

    require!(exact_output_amount >= minimum_output_amount,ErrorCode::NotMinimumOutputAmount);

    let transfer_input_ctx = CpiContext::new(ctx.accounts.input_token_program.key(),TransferChecked {
        mint:input_mint.to_account_info(),
        from:ctx.accounts.trader.to_account_info(),
        to:ctx.accounts.input_token_vault.to_account_info(),
        authority:ctx.accounts.trader.to_account_info(),
    });

    transfer_checked(transfer_input_ctx,exact_input_amount, ctx.accounts.input_mint.decimals)?;

    let amm_config_key = ctx.accounts.amm_config.key();

    let pool = &ctx.accounts.pool;

    let pool_seeds:&[&[u8]] = &[Pool::STATIC_SEED,amm_config_key.as_ref(),pool.mint_0.as_ref(),pool.mint_1.as_ref(),&[pool.bump]];
    let signer_seeds = [&pool_seeds[..]];

    let transfer_output_ctx = CpiContext::new(ctx.accounts.output_token_program.key(),TransferChecked {
        mint:output_mint.to_account_info(),
        from:ctx.accounts.output_token_vault.to_account_info(),
        to:ctx.accounts.trader_output_token.to_account_info(),
        authority:ctx.accounts.pool.to_account_info(),
    }).with_signer(&signer_seeds);

    transfer_checked(transfer_output_ctx,net_output_amount, ctx.accounts.output_mint.decimals)?;

    ctx.accounts.input_token_vault.reload();
    ctx.accounts.output_token_vault.reload();

    let new_x = ctx.accounts.input_token_vault.amount;
    let new_y = ctx.accounts.output_token_vault.amount;
    let new_k = new_x.checked_mul(new_y).unwrap();

    require!(new_k >= k,ErrorCode::ConstantProductInvariantFailed);
    Ok(())
}
