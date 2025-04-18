const UserModel = require('../models/UserModel')

async function getUserByPhone(request, response) {
    try {
        const { phone } = request.params

        if (!phone) {
            return response.status(400).json({
                message: "Phone number is required",
                error: true
            })
        }

        const user = await UserModel.findOne({ phone }).select("name profile_pic")

        if (!user) {
            return response.status(404).json({
                message: "User not found",
                error: true
            })
        }

        return response.json({
            message: "User details retrieved successfully",
            data: {
                name: user.name,
                profile_pic: user.profile_pic
            },
            success: true
        })
    } catch (error) {
        return response.status(500).json({
            message: error.message || "Something went wrong",
            error: true
        })
    }
}

module.exports = getUserByPhone
