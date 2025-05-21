import numpy as np
import torch as th
import json
import argsparse
# parser = argsparse.ArgumentParser()
# parser.add_argument('--path', type=str, required=True)
# args = parser.parse_args()


def rotation_6d_to_matrix(d6: th.Tensor) -> th.Tensor:
    """
    Converts 6D rotation representation by Zhou et al. [1] to rotation matrix
    using Gram--Schmidt orthogonalisation per Section B of [1].
    Args:
        d6: 6D rotation representation, of size (*, 6)

    Returns:
        batch of rotation matrices of size (*, 3, 3)

    [1] Zhou, Y., Barnes, C., Lu, J., Yang, J., & Li, H.
    On the Continuity of Rotation Representations in Neural Networks.
    IEEE Conference on Computer Vision and Pattern Recognition, 2019.
    Retrieved from http://arxiv.org/abs/1812.07035
    """

    a1, a2 = d6[..., :3], d6[..., 3:]
    b1 = th.nn.functional.normalize(a1, dim=-1)
    b2 = a2 - (b1 * a2).sum(-1, keepdim=True) * b1
    b2 = th.nn.functional.normalize(b2, dim=-1)
    b3 = th.cross(b1, b2, dim=-1)
    R = th.stack((b1, b2, b3), dim=-2)
    
    # Check orthogonality
    # assert th.allclose(R.transpose(-2, -1) @ R, th.eye(3, device=d6.device).expand_as(R), atol=1e-4)
    # Check determinant
    # assert th.allclose(th.det(R), th.ones(1, device=d6.device))
    return R

path = "/home/mint/Dev/HumanMotion/Diffusion-Noise-Optimization/save/mdm_avg_dno/samples_000500000_avg_seed20_a_person_is_standing"
mode = "pose_editing_reprojection_dno"

data = np.load(f"{path}/{mode}/results.npy", allow_pickle=True).item()  # Ensure it's loaded as dict
print("keys: ", data.keys())
print("motion: ", data["motion"].shape)

 
cam = th.load(f"{path}/{mode}/cam_dict.pt")   
for k, v in cam.items():
    print(k, v.shape)

R = cam["camera_R"].permute(0, 2, 1)
R = rotation_6d_to_matrix(R)    # B x T x 3 x 3
R = R.detach().cpu().numpy()
T = cam["camera_T"].permute(0, 2, 1)    # B x T x 3
T = T.detach().cpu().numpy()
camera_center = cam["camera_center"]    # B x 2
focal_length = cam["focal_length"]    # B x 1
# print(np.linalg.inv(R[0][0]))
# print(R[0][0].T)

E = np.zeros((R.shape[0], R.shape[1], 4, 4))
E[:, :, :3, :3] = R
E[:, :, :3, 3] = T
E[:, :, 3, 3] = 1
print(E.shape)
print(np.eye(4)[None, None, ...].repeat(E.shape[1], axis=1).shape)
E = np.concatenate(
        (
            np.eye(4)[None, None, ...].repeat(E.shape[1], axis=1),
            E
        ), axis=0
)
print(E.shape)

out = {'motions': data["motion"].astype(np.float64).tolist(), # B x 22 x 3 x T
       'R': R.tolist(), # B x T x 3 x 3
       'Rinv': np.linalg.inv(R).tolist(), # B x T x 3 x 3
       'T': T.tolist(), # B x T x 3
       'E': E.tolist(), # B x T x 4 x 4
       'camera_center': camera_center.tolist(), # B x 2
       'focal_length': focal_length.tolist() # B x 1
    }   
with open("motions.json", "w") as f:
    json.dump(out, f)
