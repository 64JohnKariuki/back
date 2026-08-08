// ServiceController.js

const serviceModel = require("../models/serviceModel");

exports.createSvc = async (req, res) => {
  const { name, thumbnail, description } = req.body;

  // Ensure all required fields are present
  if (!name || !thumbnail || !description) {
    return res.status(400).json({ message: "All fields are required." });
  }

  try {
    // Corrected call to createSvc using an object to pass parameters
    const newService = await serviceModel.createService({
      name,
      thumbnail,
      description
    });

    res.status(201).json({
      message: "Service created successfully",
      Service: {
        id: newService.id,
        name: newService.name,
        thumbnail: newService.thumbnail,
        description: newService.description
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error creating Service.", error: err.message });
  }
};

exports.createPkg = async (req, res) => {
  const { name, description, service } = req.body;

  // Ensure all required fields are present
  if (!name || !description || !service) {
    return res.status(400).json({ message: "All fields are required." });
  }

  try {
    // Check if the service exists
    const svc = await serviceModel.getServiceIdByName(service); // Implement this function to fetch cervice by ID
    if (!svc) {
      return res.status(404).json({ message: "Service not found." });
    }

    // Create the Package
    const newPackage = await serviceModel.createPackage({
      name,
      description,
      service_id: svc.id // Pass service as id
    });

    res.status(201).json({
      message: "Package created successfully",
      Package: {
        id: newPackage.id,
        name: newPackage.name,
        description: newPackage.description,
        cerviceId: newPackage.id
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error creating package.", error: err.message });
  }
};

exports.getAllSvcs = async (req, res) => {
  try {
    const service = await serviceModel.getAllServices();
    res.status(200).json({ service });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching services." });
  }
};

exports.getPkgs = async (req, res) => {
  try {
    const package = await serviceModel.getAllPackages();
    res.status(200).json({ package });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching packages." });
  }
};

exports.updatePkg = async (req, res) => {
  const { id } = req.params; // Get the service ID from the request parameters
  const { name, service, description } = req.body;

  // Ensure all required fields are present
  if (!name || !service || !description) {
    return res.status(400).json({ message: "All fields are required." });
  }

  try {
    // Check if the service exists
    const svc = await serviceModel.getServiceIdByName(service); // Implement this function to fetch cervice by ID
    if (!svc) {
      return res.status(404).json({ message: "Service not found." });
    }

    // Call the model function to update the package
    const updatedPackage = await serviceModel.updatePackage(id, {
      name,
      service_id: svc.id,
      description
    });

    if (!updatedPackage) {
      return res.status(404).json({ message: "Package not found." });
    }

    res.status(200).json({
      message: "Package updated successfully",
      service: updatedPackage, // Return the updated Package object
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error updating Package.", error: err.message });
  }
};

//Update Service
exports.updateSvc = async (req, res) => {
  const { id } = req.params; // Get the service ID from the request parameters
  const { name, description } = req.body;

  // Ensure all required fields are present
  if (!name || !description) {
    return res.status(400).json({ message: "All fields are required." });
  }

  try {
    // Call the model function to update the category
    const updatedService = await serviceModel.updateService(id, {
      name,
      description
    });

    if (!updatedService) {
      return res.status(404).json({ message: "Service not found." });
    }

    res.status(200).json({
      message: "Service updated successfully",
      service: updatedService, // Return the updated Service object
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error updating Service.", error: err.message });
  }
};

// Delete a service
exports.deleteSvc = async (req, res) => {
  const { id } = req.params; // Get the service ID from the request parameters

  try {
    // Call the model function to delete the service
    const deletedService = await serviceModel.deleteService(id);

    if (!deletedService) {
      return res.status(404).json({ message: "Service not found." });
    }

    res.status(200).json({ message: "Service deleted successfully." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error deleting Service.", error: err.message });
  }
};

// Delete a package
exports.deletePkg = async (req, res) => {
  const { id } = req.params; // Get the Package ID from the request parameters

  try {
    // Call the model function to delete the Package
    const deletedPackage = await serviceModel.deletePackage(id);

    if (!deletedPackage) {
      return res.status(404).json({ message: "Package not found." });
    }

    res.status(200).json({ message: "Package deleted successfully." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error deleting Package.", error: err.message });
  }
};