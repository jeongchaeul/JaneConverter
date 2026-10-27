#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let _instance_guard = match janeconverter_desktop_lib::acquire_instance_slot() {
        Some(guard) => guard,
        None => {
            janeconverter_desktop_lib::bring_active_window_to_top();
            std::process::exit(0);
        }
    };

    janeconverter_desktop_lib::run();
}
