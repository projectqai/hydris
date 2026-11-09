fn main() -> Result<(), Box<dyn std::error::Error>> {
    tonic_build::configure()
        .build_server(true)
        .build_client(true)
        .out_dir("src/gen")
        .compile_protos(
            &[
                "../geometry.proto",
                "../metrics.proto",
                "../world.proto",
                "../timeline.proto",
            ],
            &[".."],
        )?;
    Ok(())
}
