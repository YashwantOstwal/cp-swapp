
pub struct CurveMath {}

impl CurveMath {
    pub fn calculate_curve_output_amount(input_reserve:u64,output_reserve:u64,new_input_reserve:u64) -> u64{
        // x.y = (x + Δx).(y - Δy)
        // (x.y)/(x + Δx) = y - Δy
        // Δy = y - ((x.y)/(x + Δx))
        // Δy = (y.(x + Δx) - (x.y)) / (x + Δx)
        // Δy = (y.(x + Δx) - k) / (x + Δx)

        let k = input_reserve.checked_mul(output_reserve).unwrap();
        output_reserve.checked_mul(new_input_reserve).unwrap().checked_sub(k).unwrap().checked_div(new_input_reserve).unwrap()
    }

    pub fn calculate_curve_input_amount(input_reserve:u64,output_reserve:u64,new_output_reserve:u64) -> u64 {
        // x.y = (x + Δx).(y - Δy) 
        // (x.y) / (y - Δy) = x + Δx
        // Δx = ((x.y) / (y - Δy)) - x
        // Δx = (k - x.(y - Δy)) / (y - Δy) (ceil division)

        let k = CurveMath::calculate_k(input_reserve, output_reserve);
        k.checked_sub(input_reserve.checked_mul(new_output_reserve).unwrap()).unwrap().div_ceil(new_output_reserve)
    }
    pub fn calculate_k(input_reserve:u64,output_reserve:u64) -> u64 {
        input_reserve.checked_mul(output_reserve).unwrap()
    }
}