import numpy as np
import json

# data = np.load("/home/mint/Dev/HumanMotion/Diffusion-Noise-Optimization/save/mdm_avg_dno/samples_000500000_avg_seed20_a_person_is_jumping/trajectory_editing_dno/results.npy", allow_pickle=True).item()  # Ensure it's loaded as dict
# data = np.load("/home/mint/Dev/HumanMotion/Diffusion-Noise-Optimization/save/mdm_avg_dno/samples_000500000_avg_seed20_a_person_is_jumping/dense_optimization_dno/results.npy", allow_pickle=True).item()  # Ensure it's loaded as dict
data = np.load("/home/mint/Dev/HumanMotion/Diffusion-Noise-Optimization/save/mdm_avg_dno/samples_000500000_avg_seed20_a_person_is_running/trajectory_editing_dno/results.npy", allow_pickle=True).item()  # Ensure it's loaded as dict
print("keys: ", data.keys())
print("motion: ", data["motion"].shape)

out = {'motions': data["motion"].astype(np.float64).tolist()}   # B x 22 x 3 x T
with open("motions.json", "w") as f:
    json.dump(out, f)
