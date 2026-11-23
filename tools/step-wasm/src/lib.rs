// SPDX-License-Identifier: BSD-3-Clause
use oxideav_step::{Occurrence, ReadOptions, StepModel, Transform, read_step_with};

const MAX_BYTES: usize = 16 * 1024 * 1024;
const MAX_TRIANGLES: usize = 150_000;
const MAX_VERTICES: usize = 250_000;
const MAX_BODIES: usize = 256;
const MAX_COORDINATE: f64 = 1_000_000.0;

fn write_u32(out: &mut Vec<u8>, n: usize) {
    out.extend_from_slice(&(n as u32).to_le_bytes());
}

fn write_name(out: &mut Vec<u8>, name: &str) {
    let name: String = name.chars().filter(|c| !c.is_control()).take(76).collect();
    write_u32(out, name.len());
    out.extend_from_slice(name.as_bytes());
}

#[derive(Default)]
struct Meshes {
    bytes: Vec<u8>,
    bodies: usize,
    triangles: usize,
    vertices: usize,
}

impl Meshes {
    fn occurrence(
        &mut self,
        model: &StepModel,
        current: &Occurrence,
        parent: &Transform,
        ancestors: &mut Vec<usize>,
        prefix: &str,
    ) -> Result<(), &'static str> {
        if ancestors.len() >= 32 || ancestors.contains(&current.part) {
            return Err("STEP assembly nesting is invalid or too deep");
        }
        let part = model.parts.get(current.part).ok_or("Missing STEP part")?;
        let world = parent.compose(&current.transform);
        let [x, y, z] = world.cols;
        let det = x[0] * (y[1] * z[2] - y[2] * z[1]) - y[0] * (x[1] * z[2] - x[2] * z[1])
            + z[0] * (x[1] * y[2] - x[2] * y[1]);
        if !det.is_finite() || det.abs() < 1e-12 {
            return Err("STEP instance transform is invalid");
        }
        let unit = model.length_unit_metres * 1000.0;
        let label = current
            .name
            .as_deref()
            .or(part.name.as_deref())
            .unwrap_or("");
        let path = [prefix, label]
            .into_iter()
            .filter(|name| !name.is_empty())
            .collect::<Vec<_>>()
            .join(" / ");
        for shape in &part.shapes {
            let mesh = &shape.mesh;
            self.bodies += 1;
            self.triangles += mesh.triangles.len();
            self.vertices += mesh.positions.len();
            if self.bodies > MAX_BODIES
                || self.triangles > MAX_TRIANGLES
                || self.vertices > MAX_VERTICES
            {
                return Err("STEP model exceeds the mesh limit");
            }
            if mesh.positions.len() < 3 || mesh.triangles.is_empty() {
                return Err("STEP part has no usable triangles");
            }
            let name = match (path.is_empty(), shape.name.as_deref()) {
                (true, None) => String::new(),
                (true, Some(name)) => name.to_owned(),
                (false, Some(name)) if name != label => format!("{path} / {name}"),
                _ => path.clone(),
            };
            write_name(&mut self.bytes, &name);
            let rgba = shape.colour.unwrap_or([0.58, 0.65, 0.72, 1.0]);
            for channel in &rgba[..3] {
                self.bytes
                    .push((channel.clamp(0.0, 1.0) * 255.0).round() as u8);
            }
            self.bytes.push(0);
            write_u32(&mut self.bytes, mesh.positions.len());
            write_u32(&mut self.bytes, mesh.triangles.len());
            for p in &mesh.positions {
                for v in world.apply(*p) {
                    let mm = v * unit;
                    if !mm.is_finite() || mm.abs() > MAX_COORDINATE {
                        return Err("STEP coordinates exceed the CAD range");
                    }
                    self.bytes.extend_from_slice(&mm.to_le_bytes());
                }
            }
            for &[a, b, c] in &mesh.triangles {
                for index in if det < 0.0 { [a, c, b] } else { [a, b, c] } {
                    write_u32(&mut self.bytes, index as usize);
                }
            }
        }
        ancestors.push(current.part);
        for child in &part.children {
            self.occurrence(model, child, &world, ancestors, &path)?;
        }
        ancestors.pop();
        Ok(())
    }
}

fn read(bytes: &[u8]) -> Result<Meshes, String> {
    let mut options = ReadOptions::default();
    options.parse_limits.max_input_len = MAX_BYTES;
    options.parse_limits.max_instances = 250_000;
    options.parse_limits.max_string_len = 65_536;
    options.geometry_limits.max_triangles = MAX_TRIANGLES;
    options.geometry_limits.max_curve_samples = 4096;
    let model = read_step_with(bytes, &options).map_err(|error| error.to_string())?;
    if let Some(warning) = model.warnings.first() {
        return Err(warning.clone());
    }
    let mut output = Meshes::default();
    for root in &model.roots {
        output.occurrence(&model, root, &Transform::IDENTITY, &mut Vec::new(), "")?;
    }
    if output.bodies == 0 {
        return Err("STEP file has no placed mesh geometry".into());
    }
    Ok(output)
}

// A fresh worker owns one wasm instance per import. It copies these buffers
// and then terminates, so there is no long-lived allocation state.
#[unsafe(no_mangle)]
pub extern "C" fn step_alloc(length: usize) -> *mut u8 {
    if length > MAX_BYTES {
        return std::ptr::null_mut();
    }
    Box::into_raw(vec![0u8; length].into_boxed_slice()) as *mut u8
}

/// # Safety
/// The caller passes a buffer allocated by step_alloc with exactly this length.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn step_read(input: *const u8, length: usize) -> *mut u8 {
    if input.is_null() || length > MAX_BYTES {
        return std::ptr::null_mut();
    }
    let result = read(unsafe { std::slice::from_raw_parts(input, length) });
    let mut out = Vec::new();
    match result {
        Ok(meshes) => {
            write_u32(&mut out, 12 + meshes.bytes.len());
            write_u32(&mut out, 0);
            write_u32(&mut out, meshes.bodies);
            out.extend_from_slice(&meshes.bytes);
        }
        Err(error) => {
            write_u32(&mut out, 8 + error.len());
            write_u32(&mut out, 1);
            out.extend_from_slice(error.as_bytes());
        }
    }
    Box::into_raw(out.into_boxed_slice()) as *mut u8
}
